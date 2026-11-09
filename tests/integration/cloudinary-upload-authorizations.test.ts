import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processImageDeletionJobs } from '@/server/services/account-deletion-cleanup';
import { createServerDB, type SqliteServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import {
  authorizeCloudinaryUpload,
  CloudinaryUploadAuthorizationError,
  dueCloudinaryUploadAuthorizations,
  finalizeCloudinaryUpload,
} from '@/server/repositories/cloudinary-upload-repository';

let database: SqliteServerDB;

function user() {
  const id = randomUUID();
  const sessionId = randomUUID();
  database.raw.prepare('INSERT INTO users(id,email,display_name,password_hash) VALUES(?,?,?,?)')
    .run(id, `${id}@example.test`, 'Upload synthetic', 'password-hash');
  database.raw.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)')
    .run(sessionId, id, '2099-01-01T00:00:00.000Z');
  return { id, sessionId };
}

beforeEach(async () => {
  const db = await createServerDB(parseServerEnv({ DATABASE_PROVIDER: 'sqlite', DATABASE_URL: 'file::memory:', NODE_ENV: 'test' }));
  if (db.dialect !== 'sqlite') throw new Error('Solo SQLite aislado');
  database = db;
});

afterEach(() => database.raw.close());

describe('autorizaciones de subidas Cloudinary', () => {
  it('persiste la firma antes de emitirla, la liga a sesión/propietario y crea un ID físico irrepetible', async () => {
    const owner = user();
    const authorization = await authorizeCloudinaryUpload({ userId: owner.id, sessionId: owner.sessionId,
      imageId: randomUUID(), folder: `isolated/${owner.id}`, database });
    expect(authorization.state).toBe('AUTHORIZED');
    expect(authorization.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(database.raw.prepare('SELECT user_id,session_id,state FROM cloudinary_upload_authorizations WHERE id=?')
      .get(authorization.id)).toEqual({ user_id: owner.id, session_id: owner.sessionId, state: 'AUTHORIZED' });
    await expect(authorizeCloudinaryUpload({ userId: owner.id, sessionId: randomUUID(), imageId: randomUUID(),
      folder: `isolated/${owner.id}`, database })).rejects.toMatchObject({ status: 401 });
  });

  it('rechaza una identidad de imagen que pertenece a otra cuenta', async () => {
    const first = user(); const second = user(); const imageId = randomUUID();
    database.raw.prepare("INSERT INTO images(id,user_id,mime_type,byte_size,data,storage_provider,storage_key) VALUES(?,?,?,1,?,'cloudinary',?)")
      .run(imageId, first.id, 'image/webp', null, `isolated/${first.id}/old`);
    await expect(authorizeCloudinaryUpload({ userId: second.id, sessionId: second.sessionId, imageId,
      folder: `isolated/${second.id}`, database })).rejects.toMatchObject({ status: 409 });
  });

  it('persiste el resultado solo con la misma sesión y autorización vigente', async () => {
    const owner = user(); const imageId = randomUUID();
    const authorization = await authorizeCloudinaryUpload({ userId: owner.id, sessionId: owner.sessionId,
      imageId, folder: `isolated/${owner.id}`, database });
    const expectedPublicId = `${authorization.folder}/${authorization.publicId}`;
    const input = { authorizationId: authorization.id, userId: owner.id, sessionId: owner.sessionId, imageId,
      expectedPublicId, remoteUrl: `https://images.example.test/${authorization.publicId}`, width: 80, height: 60,
      byteSize: 1500, database };
    database.raw.prepare('DELETE FROM sessions WHERE id=?').run(owner.sessionId);
    await expect(finalizeCloudinaryUpload(input)).rejects.toMatchObject({ status: 401 });
    database.raw.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)')
      .run(owner.sessionId, owner.id, '2099-01-01T00:00:00.000Z');
    await expect(finalizeCloudinaryUpload({ ...input, sessionId: randomUUID() })).rejects.toMatchObject({ status: 401 });
    const result = await finalizeCloudinaryUpload(input);
    expect(result).toMatchObject({ id: imageId, userId: owner.id, storageProvider: 'cloudinary', storageKey: expectedPublicId });
    expect(database.raw.prepare('SELECT state FROM cloudinary_upload_authorizations WHERE id=?').get(authorization.id))
      .toEqual({ state: 'FINALIZED' });
    expect(await finalizeCloudinaryUpload(input)).toEqual(result); // response-loss retry is idempotent
  });

  it('permite editar una prenda con el mismo ID lógico pero usa otro recurso físico y rechaza la firma anterior', async () => {
    const owner = user(); const imageId = randomUUID();
    const first = await authorizeCloudinaryUpload({ userId: owner.id, sessionId: owner.sessionId,
      imageId, folder: `isolated/${owner.id}`, database });
    const finalize = (authorization: typeof first) => finalizeCloudinaryUpload({ authorizationId: authorization.id,
      userId: owner.id, sessionId: owner.sessionId, imageId, expectedPublicId: `${authorization.folder}/${authorization.publicId}`,
      remoteUrl: `https://images.example.test/${authorization.publicId}`, width: 80, height: 60, byteSize: 1500, database });
    const original = await finalize(first);
    const replacement = await authorizeCloudinaryUpload({ userId: owner.id, sessionId: owner.sessionId,
      imageId, folder: `isolated/${owner.id}`, database });
    expect(replacement.publicId).not.toBe(first.publicId);
    expect(database.raw.prepare('SELECT state FROM cloudinary_upload_authorizations WHERE id=?').get(first.id))
      .toEqual({ state: 'REVOKED' });
    await expect(finalize(first)).rejects.toBeInstanceOf(CloudinaryUploadAuthorizationError);
    const updated = await finalize(replacement);
    expect(updated.id).toBe(original.id);
    expect(updated.storageKey).not.toBe(original.storageKey);
  });

  it('la baja del usuario revoca firmas/finalizaciones aún no expiradas y el finalizado no las rescata', async () => {
    const owner = user(); const authorization = await authorizeCloudinaryUpload({ userId: owner.id,
      sessionId: owner.sessionId, imageId: randomUUID(), folder: `isolated/${owner.id}`, database });
    database.raw.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(owner.id);
    expect(database.raw.prepare('SELECT state FROM cloudinary_upload_authorizations WHERE id=?').get(authorization.id))
      .toEqual({ state: 'REVOKED' });
    await expect(finalizeCloudinaryUpload({ authorizationId: authorization.id, userId: owner.id, sessionId: owner.sessionId,
      imageId: authorization.imageId, expectedPublicId: `${authorization.folder}/${authorization.publicId}`,
      remoteUrl: 'https://images.example.test/late', width: 40, height: 30, byteSize: 1200, database }))
      .rejects.toBeInstanceOf(CloudinaryUploadAuthorizationError);
  });

  it('rechaza finalizar cuando expiró la firma, aunque todavía exista una sesión activa', async () => {
    const owner = user(); const authorization = await authorizeCloudinaryUpload({ userId: owner.id,
      sessionId: owner.sessionId, imageId: randomUUID(), folder: `isolated/${owner.id}`,
      now: Date.now() - 2 * 60 * 60_000, database });
    await expect(finalizeCloudinaryUpload({ authorizationId: authorization.id, userId: owner.id, sessionId: owner.sessionId,
      imageId: authorization.imageId, expectedPublicId: `${authorization.folder}/${authorization.publicId}`,
      remoteUrl: 'https://images.example.test/expired', width: 40, height: 30, byteSize: 1200, database }))
      .rejects.toMatchObject({ status: 409 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM images').get()).toEqual({ n: 0 });
  });

  it('reconcilia una subida tardía más de una vez sin borrar referencias compartidas ni llamar servicios reales', async () => {
    const owner = user(); const authorization = await authorizeCloudinaryUpload({ userId: owner.id,
      sessionId: owner.sessionId, imageId: randomUUID(), folder: `isolated/${owner.id}`,
      now: Date.now() - 2 * 60 * 60_000, database });
    database.raw.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(owner.id);
    const exists = vi.fn(async () => true);
    const destroy = vi.fn(async () => undefined);
    const options = { database, allowCloudinary: true, storagePrefix: 'isolated', assetExists: exists, destroy };
    const first = await processImageDeletionJobs(options);
    expect(first.completed).toBe(1);
    expect(destroy).toHaveBeenCalledWith(`${authorization.folder}/${authorization.publicId}`);
    database.raw.prepare("UPDATE cloudinary_upload_authorizations SET next_check_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .run(authorization.id);
    const second = await processImageDeletionJobs(options);
    expect(second.completed).toBe(1);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect((await dueCloudinaryUploadAuthorizations(10, database))).toHaveLength(0);
  });

  it('continúa el barrido después de que Cloudinary responda no encontrado', async () => {
    const owner = user(); const authorization = await authorizeCloudinaryUpload({ userId: owner.id,
      sessionId: owner.sessionId, imageId: randomUUID(), folder: `isolated/${owner.id}`,
      now: Date.now() - 2 * 60 * 60_000, database });
    database.raw.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(owner.id);
    const result = await processImageDeletionJobs({ database, allowCloudinary: true,
      storagePrefix: 'isolated', assetExists: async () => false });
    expect(result.completed).toBe(0);
    expect(database.raw.prepare('SELECT state FROM cloudinary_upload_authorizations WHERE id=?').get(authorization.id))
      .toEqual({ state: 'RECONCILE' });
    expect(database.raw.prepare('SELECT count(*) AS n FROM image_deletion_jobs').get()).toEqual({ n: 0 });
  });

  it('reintenta reconciliar si la consulta al proveedor falla temporalmente', async () => {
    const owner = user(); const authorization = await authorizeCloudinaryUpload({ userId: owner.id,
      sessionId: owner.sessionId, imageId: randomUUID(), folder: `isolated/${owner.id}`,
      now: Date.now() - 2 * 60 * 60_000, database });
    database.raw.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(owner.id);
    const first = await processImageDeletionJobs({ database, allowCloudinary: true, storagePrefix: 'isolated',
      assetExists: vi.fn(async () => { throw new Error('synthetic provider outage'); }) });
    expect(first.failed).toBe(1);
    expect(database.raw.prepare('SELECT state FROM cloudinary_upload_authorizations WHERE id=?').get(authorization.id))
      .toEqual({ state: 'RECONCILE' });
    database.raw.prepare("UPDATE cloudinary_upload_authorizations SET next_check_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .run(authorization.id);
    const second = await processImageDeletionJobs({ database, allowCloudinary: true, storagePrefix: 'isolated',
      assetExists: async () => true, destroy: async () => undefined });
    expect(second.completed).toBe(1);
    expect(database.raw.prepare('SELECT count(*) AS n FROM image_deletion_jobs WHERE state=?').get('DONE'))
      .toEqual({ n: 1 });
  });

  it('no destruye un recurso que sigue referenciado por otra cuenta', async () => {
    const owner = user(); const other = user();
    const authorization = await authorizeCloudinaryUpload({ userId: owner.id, sessionId: owner.sessionId,
      imageId: randomUUID(), folder: `isolated/${owner.id}`, now: Date.now() - 2 * 60 * 60_000, database });
    const key = `${authorization.folder}/${authorization.publicId}`;
    database.raw.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(owner.id);
    database.raw.prepare("INSERT INTO images(id,user_id,mime_type,byte_size,data,storage_provider,storage_key,remote_url) VALUES(?,?,?,1,NULL,'cloudinary',?,?)")
      .run(randomUUID(), other.id, 'image/webp', key, `https://images.example.test/${authorization.publicId}`);
    const destroy = vi.fn(async () => undefined);
    const result = await processImageDeletionJobs({ database, allowCloudinary: true, storagePrefix: 'isolated',
      assetExists: async () => true, destroy });
    expect(result.sharedOrLeased).toBe(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(database.raw.prepare('SELECT state FROM image_deletion_jobs WHERE storage_key=?').get(key))
      .toEqual({ state: 'SHARED' });
  });
});
