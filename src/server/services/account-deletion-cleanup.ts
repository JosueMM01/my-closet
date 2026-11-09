import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ServerDB } from '@/server/db';
import { getCloudinaryCredentials, getEnv } from '@/server/env';
import { blockImageDeletionJob, claimImageDeletionJob, dueImageDeletionIds, finishImageDeletionJob } from '@/server/repositories/account-deletion-repository';
import {
  claimCloudinaryUploadReconciliation,
  dueCloudinaryUploadAuthorizations,
  enqueueCloudinaryAuthorizationDeletion,
  hasPendingCloudinaryDeletion,
  scheduleCloudinaryUploadRecheck,
} from '@/server/repositories/cloudinary-upload-repository';

export function isDeletionStorageKeyInScope(key: string | null, prefix: string | undefined): key is string {
  return !!key && !!prefix && key.startsWith(`${prefix}/`) && key.length <= 1024
    && !/[\r\n\0]/.test(key) && !key.split('/').some(part => !part || part === '.' || part === '..');
}

async function destroyCloudinaryImage(publicId: string): Promise<void> {
  const credentials = getCloudinaryCredentials();
  if (!credentials) throw new Error('Remote cleanup unavailable');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha1').update(`invalidate=true&public_id=${publicId}&timestamp=${timestamp}${credentials.apiSecret}`).digest('hex');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/destroy`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8_000),
    body: new URLSearchParams({ public_id: publicId, invalidate: 'true', timestamp: String(timestamp), api_key: credentials.apiKey, signature }),
  });
  const result = z.object({ result: z.enum(['ok', 'not found']) }).safeParse(await response.json().catch(() => null));
  if (!response.ok || !result.success) throw new Error('Remote cleanup failed');
}

async function cloudinaryAssetExists(publicId: string): Promise<boolean> {
  const credentials = getCloudinaryCredentials();
  if (!credentials) throw new Error('Remote cleanup unavailable');
  const auth = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}`
    + `/resources/image/upload/${encodeURIComponent(publicId)}`, {
    headers: { authorization: `Basic ${auth}` }, cache: 'no-store', signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return false;
  const resource = z.object({ public_id: z.string() }).safeParse(await response.json().catch(() => null));
  if (!response.ok || !resource.success || resource.data.public_id !== publicId) throw new Error('Remote lookup failed');
  return true;
}

/** At most 25 jobs. Credentials never enter the queue, diagnostics or client. */
export async function processImageDeletionJobs(input: {
  database?: ServerDB; limit?: number; allowCloudinary?: boolean; storagePrefix?: string;
  destroy?: (publicId: string) => Promise<void>;
  assetExists?: (publicId: string) => Promise<boolean>;
} = {}): Promise<{ completed: number; sharedOrLeased: number; deferred: number; blocked: number; failed: number }> {
  const env = getEnv();
  const counts = { completed: 0, sharedOrLeased: 0, deferred: 0, blocked: 0, failed: 0 };

  // Reconcile signed uploads which may have completed after the account's image rows were removed.
  // Keep the authorization tombstone and repeat checks; Cloudinary does not promise a maximum
  // lifetime for a request that started while its signature was valid.
  const uploadAuthorizations = await dueCloudinaryUploadAuthorizations(input.limit, input.database);
  for (const candidate of uploadAuthorizations) {
    const authorization = await claimCloudinaryUploadReconciliation(candidate.id, input.database);
    if (!authorization) continue;
    if (!(input.allowCloudinary ?? env.ACCOUNT_DELETION_REMOTE_CLEANUP_ENABLED)) {
      counts.deferred++;
      await scheduleCloudinaryUploadRecheck(authorization.id, input.database);
      continue;
    }
    const key = `${authorization.folder}/${authorization.publicId}`;
    if (!isDeletionStorageKeyInScope(key, input.storagePrefix ?? env.CLOUDINARY_FOLDER_PREFIX)) {
      counts.blocked++;
      await scheduleCloudinaryUploadRecheck(authorization.id, input.database);
      continue;
    }
    try {
      const exists = await (input.assetExists ?? cloudinaryAssetExists)(key);
      if (exists && !await hasPendingCloudinaryDeletion(key, input.database)) {
        await enqueueCloudinaryAuthorizationDeletion({ storageKey: key,
          remoteUrl: null, database: input.database });
      }
      await scheduleCloudinaryUploadRecheck(authorization.id, input.database);
    } catch {
      counts.failed++;
      await scheduleCloudinaryUploadRecheck(authorization.id, input.database);
    }
  }

  const ids = await dueImageDeletionIds(input.limit, input.database);
  for (const id of ids) {
    const job = await claimImageDeletionJob(id, input.database);
    if (!job) { counts.sharedOrLeased++; continue; }
    if (job.storage_provider === 'cloudinary') {
      if (!(input.allowCloudinary ?? env.ACCOUNT_DELETION_REMOTE_CLEANUP_ENABLED)) { counts.deferred++; continue; }
      if (!isDeletionStorageKeyInScope(job.storage_key, input.storagePrefix ?? env.CLOUDINARY_FOLDER_PREFIX)) {
        await blockImageDeletionJob(id, input.database); counts.blocked++; continue;
      }
      try { await (input.destroy ?? destroyCloudinaryImage)(job.storage_key); }
      catch { counts.failed++; continue; } // Keep PROCESSING and payload for a later idempotent retry.
    }
    await finishImageDeletionJob(id, input.database);
    counts.completed++;
  }
  return counts;
}
