import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ServerDB } from '@/server/db';
import { getCloudinaryCredentials, getEnv } from '@/server/env';
import { blockImageDeletionJob, claimImageDeletionJob, dueImageDeletionIds, finishImageDeletionJob } from '@/server/repositories/account-deletion-repository';

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

/** At most 25 jobs. Credentials never enter the queue, diagnostics or client. */
export async function processImageDeletionJobs(input: {
  database?: ServerDB; limit?: number; allowCloudinary?: boolean; storagePrefix?: string;
  destroy?: (publicId: string) => Promise<void>;
} = {}): Promise<{ completed: number; sharedOrLeased: number; deferred: number; blocked: number; failed: number }> {
  const env = getEnv();
  const counts = { completed: 0, sharedOrLeased: 0, deferred: 0, blocked: 0, failed: 0 };
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
