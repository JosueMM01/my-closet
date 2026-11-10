import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createServerDB, pgSchema, type ServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import { processImageDeletionJobs } from '@/server/services/account-deletion-cleanup';
import {
  authorizeCloudinaryUpload,
  CloudinaryUploadAuthorizationError,
  finalizeCloudinaryUpload,
} from '@/server/repositories/cloudinary-upload-repository';

type Database = Extract<ServerDB, { dialect: 'postgres' }>;
let first: Database;
let second: Database;
const users: string[] = [];
const sessions: string[] = [];
const authorizations: string[] = [];
const images: string[] = [];
const uploadKeys: string[] = [];
const suite = process.env.CLOUDINARY_UPLOAD_CONTRACT_DATABASE_URL ? describe : describe.skip;

suite('autorizaciones Cloudinary en PostgreSQL sintético aislado', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const rawUrl = process.env.CLOUDINARY_UPLOAD_CONTRACT_DATABASE_URL;
    if (!rawUrl) throw new Error('Falta destino explícito de contrato Cloudinary');
    const uri = new URL(rawUrl);
    const host = uri.hostname.replace('-pooler', '');
    if (!['postgres:', 'postgresql:'].includes(uri.protocol)
      || !process.env.CLOUDINARY_UPLOAD_CONTRACT_EXPECTED_HOST
      || !process.env.CLOUDINARY_UPLOAD_CONTRACT_PRODUCTION_HOST
      || host !== process.env.CLOUDINARY_UPLOAD_CONTRACT_EXPECTED_HOST
      || host === process.env.CLOUDINARY_UPLOAD_CONTRACT_PRODUCTION_HOST
      || uri.pathname !== '/closet_5c_preview'
      || uri.username !== 'closet_5c_preview_owner') {
      throw new Error('Destino rechazado: contrato solo permite la base y rol sintéticos 5C verificados');
    }
    const env = parseServerEnv({ NODE_ENV: 'test', DATABASE_PROVIDER: 'postgres', DATABASE_URL: uri.toString(), IMAGE_PROVIDER: 'local' });
    const a = await createServerDB(env);
    const b = await createServerDB(env);
    if (a.dialect !== 'postgres' || b.dialect !== 'postgres') throw new Error('Contrato requiere PostgreSQL');
    first = a;
    second = b;
    // Fail closed if the isolated target has not received the new migration.
    await first.postgres.select({ id: pgSchema.cloudinaryUploadAuthorizations.id })
      .from(pgSchema.cloudinaryUploadAuthorizations).limit(1);
  });

  afterEach(async () => {
    if (!first) return;
    if (uploadKeys.length) await first.postgres.delete(pgSchema.imageDeletionJobs)
      .where(inArray(pgSchema.imageDeletionJobs.storageKey, uploadKeys));
    if (images.length) await first.postgres.delete(pgSchema.images)
      .where(inArray(pgSchema.images.id, images));
    if (authorizations.length) await first.postgres.delete(pgSchema.cloudinaryUploadAuthorizations)
      .where(inArray(pgSchema.cloudinaryUploadAuthorizations.id, authorizations));
    if (sessions.length) await first.postgres.delete(pgSchema.sessions)
      .where(inArray(pgSchema.sessions.id, sessions));
    if (users.length) {
      await first.postgres.delete(pgSchema.accountDeletions)
        .where(inArray(pgSchema.accountDeletions.userId, users));
      await first.postgres.delete(pgSchema.users)
        .where(inArray(pgSchema.users.id, users));
    }
    uploadKeys.length = 0;
    images.length = 0;
    authorizations.length = 0;
    sessions.length = 0;
    users.length = 0;
  });

  afterAll(async () => {
    if (first) await first.raw.end({ timeout: 5 });
    if (second) await second.raw.end({ timeout: 5 });
  });

  async function account() {
    const userId = randomUUID();
    const sessionId = randomUUID();
    users.push(userId);
    sessions.push(sessionId);
    await first.raw`INSERT INTO users(id,email,display_name,password_hash,role,status)
      VALUES(${userId},${`${userId}@example.test`},'Cuenta contrato Cloudinary','synthetic-only','USER','ACTIVE')`;
    await first.raw`INSERT INTO sessions(id,user_id,expires_at)
      VALUES(${sessionId},${userId},'2099-01-01T00:00:00Z')`;
    return { userId, sessionId };
  }

  async function authorize(user: Awaited<ReturnType<typeof account>>, imageId = randomUUID(), now?: number) {
    const result = await authorizeCloudinaryUpload({ userId: user.userId, sessionId: user.sessionId,
      imageId, folder: `my-closet-staging/${user.userId}`, now, database: first });
    authorizations.push(result.id);
    return result;
  }

  async function finalize(user: Awaited<ReturnType<typeof account>>, authorization: Awaited<ReturnType<typeof authorize>>) {
    const key = `${authorization.folder}/${authorization.publicId}`;
    const result = await finalizeCloudinaryUpload({ authorizationId: authorization.id, userId: user.userId,
      sessionId: user.sessionId, imageId: authorization.imageId, expectedPublicId: key,
      remoteUrl: `https://images.example.test/${authorization.publicId}`, width: 80, height: 60,
      byteSize: 1500, database: first });
    images.push(result.id);
    return result;
  }

  it('persiste antes de firmar, liga a sesión y rechaza una sesión inexistente', async () => {
    const owner = await account();
    const row = await authorize(owner);
    const [stored] = await first.raw`SELECT user_id,session_id,state FROM cloudinary_upload_authorizations WHERE id=${row.id}`;
    expect(stored).toEqual({ user_id: owner.userId, session_id: owner.sessionId, state: 'AUTHORIZED' });
    await expect(authorizeCloudinaryUpload({ userId: owner.userId, sessionId: randomUUID(), imageId: randomUUID(),
      folder: `my-closet-staging/${owner.userId}`, database: first })).rejects.toMatchObject({ status: 401 });
  });

  it('finaliza con autorización exacta, conserva reintento idempotente y rechaza sesión revocada', async () => {
    const owner = await account(); const row = await authorize(owner);
    const firstResult = await finalize(owner, row);
    expect(await finalizeCloudinaryUpload({ authorizationId: row.id, userId: owner.userId, sessionId: owner.sessionId,
      imageId: row.imageId, expectedPublicId: `${row.folder}/${row.publicId}`, remoteUrl: firstResult.remoteUrl,
      width: 80, height: 60, byteSize: 1500, database: first })).toEqual(firstResult);
    await first.raw`DELETE FROM sessions WHERE id=${owner.sessionId}`;
    await expect(finalizeCloudinaryUpload({ authorizationId: row.id, userId: owner.userId, sessionId: owner.sessionId,
      imageId: row.imageId, expectedPublicId: `${row.folder}/${row.publicId}`, remoteUrl: firstResult.remoteUrl,
      width: 80, height: 60, byteSize: 1500, database: first })).rejects.toMatchObject({ status: 401 });
  });

  it('edita el mismo ID lógico con clave física nueva y deja la revisión anterior en reconciliación', async () => {
    const owner = await account(); const imageId = randomUUID();
    const oldRevision = await authorize(owner, imageId);
    const oldImage = await finalize(owner, oldRevision);
    const newRevision = await authorize(owner, imageId);
    expect(newRevision.publicId).not.toBe(oldRevision.publicId);
    await expect(finalizeCloudinaryUpload({ authorizationId: oldRevision.id, userId: owner.userId,
      sessionId: owner.sessionId, imageId, expectedPublicId: `${oldRevision.folder}/${oldRevision.publicId}`,
      remoteUrl: oldImage.remoteUrl, width: 80, height: 60, byteSize: 1500, database: first }))
      .rejects.toBeInstanceOf(CloudinaryUploadAuthorizationError);
    const newImage = await finalize(owner, newRevision);
    expect(newImage.id).toBe(oldImage.id);
    expect(newImage.storageKey).not.toBe(oldImage.storageKey);
    const [previous] = await first.raw`SELECT state FROM cloudinary_upload_authorizations WHERE id=${oldRevision.id}`;
    expect(previous?.state).toBe('REVOKED');
  });

  it('desactivar revoca firma pendiente y bloquea finalización posterior', async () => {
    const owner = await account(); const row = await authorize(owner);
    await first.raw`UPDATE users SET status='DISABLED' WHERE id=${owner.userId}`;
    const [revoked] = await first.raw`SELECT state FROM cloudinary_upload_authorizations WHERE id=${row.id}`;
    expect(revoked?.state).toBe('REVOKED');
    await expect(finalizeCloudinaryUpload({ authorizationId: row.id, userId: owner.userId,
      sessionId: owner.sessionId, imageId: row.imageId, expectedPublicId: `${row.folder}/${row.publicId}`,
      remoteUrl: 'https://images.example.test/late', width: 80, height: 60, byteSize: 1500, database: first }))
      .rejects.toBeInstanceOf(CloudinaryUploadAuthorizationError);
  });

  it('serializa firma contra desactivación en conexiones distintas', async () => {
    const owner = await account();
    const [issue] = await Promise.allSettled([
      authorize(owner),
      second.raw`UPDATE users SET status='DISABLED' WHERE id=${owner.userId}`,
    ]);
    const [accountRow] = await first.raw`SELECT status FROM users WHERE id=${owner.userId}`;
    expect(accountRow?.status).toBe('DISABLED');
    if (issue?.status === 'fulfilled') {
      const [row] = await first.raw`SELECT state FROM cloudinary_upload_authorizations WHERE id=${issue.value.id}`;
      expect(row?.state).toBe('REVOKED');
    }
    const [remaining] = await first.raw`SELECT count(*)::int AS n FROM cloudinary_upload_authorizations WHERE user_id=${owner.userId} AND state='AUTHORIZED'`;
    expect(remaining?.n).toBe(0);
  });

  it('no elimina en reconcile una clave física que sigue referenciada por otra cuenta', async () => {
    const owner = await account(); const other = await account();
    const row = await authorize(owner, randomUUID(), Date.now() - 2 * 60 * 60_000);
    const key = `${row.folder}/${row.publicId}`; uploadKeys.push(key);
    await first.raw`UPDATE users SET status='DISABLED' WHERE id=${owner.userId}`;
    const sharedImageId = randomUUID(); images.push(sharedImageId);
    await first.raw`INSERT INTO images(id,user_id,mime_type,width,height,byte_size,data,remote_url,storage_provider,storage_key)
      VALUES(${sharedImageId},${other.userId},'image/webp',80,60,1500,NULL,${`https://images.example.test/${row.publicId}`},'cloudinary',${key})`;
    const destroy = vi.fn(async () => undefined);
    const result = await processImageDeletionJobs({ database: first, allowCloudinary: true,
      storagePrefix: 'my-closet-staging', assetExists: async () => true, destroy });
    expect(result.sharedOrLeased).toBe(1);
    expect(destroy).not.toHaveBeenCalled();
    const [job] = await first.raw`SELECT state FROM image_deletion_jobs WHERE storage_key=${key}`;
    expect(job?.state).toBe('SHARED');
  });

  it('finalización concurrente y desactivación dejan la autorización revocada o el recurso finalizado antes de desactivar', async () => {
    const owner = await account(); const row = await authorize(owner);
    const operation = finalizeCloudinaryUpload({ authorizationId: row.id, userId: owner.userId,
      sessionId: owner.sessionId, imageId: row.imageId, expectedPublicId: `${row.folder}/${row.publicId}`,
      remoteUrl: `https://images.example.test/${row.publicId}`, width: 80, height: 60, byteSize: 1500, database: first });
    const outcomes = await Promise.allSettled([operation,
      second.raw`UPDATE users SET status='DISABLED' WHERE id=${owner.userId}`]);
    const [accountRow] = await first.raw`SELECT status FROM users WHERE id=${owner.userId}`;
    const [authRow] = await first.raw`SELECT state FROM cloudinary_upload_authorizations WHERE id=${row.id}`;
    expect(accountRow?.status).toBe('DISABLED');
    expect(authRow?.state).toBe('REVOKED');
    if (outcomes[0]?.status === 'fulfilled') expect(outcomes[0].value.id).toBe(row.imageId);
    else expect(outcomes[0].reason).toBeInstanceOf(CloudinaryUploadAuthorizationError);
  });
});
