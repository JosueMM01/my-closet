import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processImageDeletionJobs } from '@/server/services/account-deletion-cleanup';
import { createServerDB, type SqliteServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import { credentialFingerprint } from '@/server/repositories/email-change-repository';
import {
  claimImageDeletionJob, deleteOwnAccount, deletionDigest, finishImageDeletionJob,
  saveDeletionProof, validDeletionProof,
} from '@/server/repositories/account-deletion-repository';

let database: SqliteServerDB;
const fingerprint = credentialFingerprint('synthetic-credential-hash');
const now = () => new Date().toISOString();

function user(role: 'ADMIN' | 'USER' = 'USER', slot: number | null = null) {
  const id = randomUUID();
  database.raw.prepare('INSERT INTO users(id,email,display_name,password_hash,role,admin_slot) VALUES(?,?,?,?,?,?)')
    .run(id, `${id}@example.test`, 'Cuenta sintética', 'synthetic-credential-hash', role, slot);
  const sessionId = randomBytes(32).toString('hex');
  database.raw.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(sessionId, id, '2099-01-01T00:00:00.000Z');
  return { userId: id, sessionId, sessionHash: deletionDigest('session', sessionId), credentialHash: fingerprint };
}

function image(userId: string, key: string = randomUUID(), provider = 'local') {
  const id = randomUUID();
  database.raw.prepare('INSERT INTO images(id,user_id,mime_type,byte_size,data,storage_provider,storage_key,remote_url) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, userId, 'image/webp', 1, Buffer.from([1]), provider, key, `https://images.example.test/${key}`);
  return id;
}

function garment(userId: string, photoId: string) {
  const id = randomUUID();
  database.raw.prepare('INSERT INTO garments(id,user_id,shareable_id,category,photo_id,created_at,updated_at,server_updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, userId, randomUUID(), 'TOP', photoId, now(), now(), now());
  return id;
}

beforeEach(async () => {
  const db = await createServerDB(parseServerEnv({ DATABASE_PROVIDER: 'sqlite', DATABASE_URL: 'file::memory:', NODE_ENV: 'test' }));
  if (db.dialect !== 'sqlite') throw new Error('Solo SQLite aislado');
  database = db;
});
afterEach(() => database.raw.close());

describe('baja transaccional de cuentas aisladas', () => {
  it('protege al último ADMIN y revierte todos los efectos', async () => {
    const target = user('ADMIN', 1);
    image(target.userId);
    await expect(deleteOwnAccount(target, database)).rejects.toMatchObject({ status: 409 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM account_deletions').get()).toEqual({ n: 0 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM image_deletion_jobs').get()).toEqual({ n: 0 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });
  it('permite salir a un ADMIN si queda otro activo', async () => {
    const target = user('ADMIN', 1);
    user('ADMIN', 2);
    expect(await deleteOwnAccount(target, database)).toEqual({ ok: true, cleanupPending: false });
    expect(database.raw.prepare("SELECT count(*) AS n FROM users WHERE role='ADMIN' AND status='ACTIVE'").get()).toEqual({ n: 1 });
  });
  it('rechaza una credencial modificada antes de la transacción', async () => {
    const target = user();
    database.raw.prepare('UPDATE users SET password_hash=? WHERE id=?').run('new-synthetic-hash', target.userId);
    await expect(deleteOwnAccount(target, database)).rejects.toMatchObject({ status: 403 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM account_deletions').get()).toEqual({ n: 0 });
  });
  it('vuelve a comprobar la sesión dentro de la transacción', async () => {
    const target = user();
    database.raw.prepare('DELETE FROM sessions WHERE id=?').run(target.sessionId);
    await expect(deleteOwnAccount(target, database)).rejects.toMatchObject({ status: 401 });
  });
  it('retira datos de cuenta, revoca sesiones y rechaza reactivaciones y sync tardío', async () => {
    const target = user();
    const photo = image(target.userId);
    garment(target.userId, photo);
    expect(await deleteOwnAccount(target, database)).toEqual({ ok: true, cleanupPending: true });
    const row = database.raw.prepare('SELECT email,display_name,password_hash,status FROM users WHERE id=?').get(target.userId);
    expect(row).toMatchObject({ display_name: 'Cuenta eliminada', status: 'DISABLED' });
    expect(row).not.toMatchObject({ password_hash: 'synthetic-credential-hash', email: `${target.userId}@example.test` });
    expect(database.raw.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(database.raw.prepare('SELECT count(*) AS n FROM garments').get()).toEqual({ n: 0 });
    expect(() => garment(target.userId, photo)).toThrow('ACCOUNT_DELETED');
    expect(() => database.raw.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(target.userId)).toThrow('ACCOUNT_DELETED');
    expect(() => database.raw.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)')
      .run(randomUUID(), target.userId, '2099-01-01T00:00:00.000Z')).toThrow('ACCOUNT_DELETED');
  });
  it('revoca varias invitaciones compartidas sin colisiones de tokens', async () => {
    const target = user();
    const other = user();
    for (let i = 0; i < 2; i++) {
      database.raw.prepare('INSERT INTO wardrobe_shares(id,grantor_id,grantee_id,permission,invite_token,created_at,updated_at,server_updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), target.userId, other.userId, 'VIEW', randomUUID(), now(), now(), now());
    }
    await deleteOwnAccount(target, database);
    expect(database.raw.prepare('SELECT count(*) AS n FROM wardrobe_shares WHERE deleted_at IS NOT NULL').get()).toEqual({ n: 2 });
  });
});

describe('worker de imágenes sin conexiones externas', () => {
  it('limpia imágenes locales idempotentemente', async () => {
    const target = user();
    image(target.userId);
    await deleteOwnAccount(target, database);
    const destroy = vi.fn();
    expect(await processImageDeletionJobs({ database, destroy })).toMatchObject({ completed: 1 });
    expect(await processImageDeletionJobs({ database, destroy })).toMatchObject({ completed: 0 });
    expect(destroy).not.toHaveBeenCalled();
  });
  it('no permite destruir recursos de producción desde una copia aislada', async () => {
    const target = user();
    image(target.userId, 'production/retained', 'cloudinary');
    await deleteOwnAccount(target, database);
    const destroy = vi.fn();
    expect(await processImageDeletionJobs({ database, allowCloudinary: true, storagePrefix: 'isolated', destroy })).toMatchObject({ blocked: 1, completed: 0 });
    expect(destroy).not.toHaveBeenCalled();
    expect(database.raw.prepare('SELECT count(*) AS n FROM images').get()).toEqual({ n: 1 });
  });
  it('conserva el trabajo tras un fallo y reintenta sin perder la clave', async () => {
    const target = user();
    image(target.userId, 'isolated/synthetic-image', 'cloudinary');
    await deleteOwnAccount(target, database);
    const destroy = vi.fn().mockRejectedValueOnce(new Error('Synthetic failure')).mockResolvedValue(undefined);
    const input = { database, allowCloudinary: true, storagePrefix: 'isolated', destroy };
    expect(await processImageDeletionJobs(input)).toMatchObject({ failed: 1, completed: 0 });
    expect(database.raw.prepare('SELECT state,storage_key FROM image_deletion_jobs').get()).toEqual({ state: 'PROCESSING', storage_key: 'isolated/synthetic-image' });
    database.raw.prepare("UPDATE image_deletion_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
    expect(await processImageDeletionJobs(input)).toMatchObject({ completed: 1 });
    expect(destroy).toHaveBeenNthCalledWith(2, 'isolated/synthetic-image');
  });
});

describe('prueba Google ligada a cuenta, credenciales y sesión', () => {
  function link(userId: string) {
    database.raw.prepare("INSERT INTO auth_accounts(id,user_id,provider,provider_subject,provider_email) VALUES(?,?,'GOOGLE',?,?)")
      .run(randomUUID(), userId, `google-${userId}`, `${userId}@example.test`);
  }
  it('se consume con la baja y no se puede reutilizar', async () => {
    const target = user();
    link(target.userId);
    const token = randomBytes(32).toString('base64url');
    await saveDeletionProof({ ...target, token, googleSubject: `google-${target.userId}` }, database);
    expect(await validDeletionProof(target.userId, token, target.sessionHash, database)).toBe(true);
    expect(await validDeletionProof(target.userId, token, 'otra-sesion', database)).toBe(false);
    await deleteOwnAccount({ ...target, credentialHash: undefined, googleProof: token }, database);
    expect(await validDeletionProof(target.userId, token, target.sessionHash, database)).toBe(false);
    await expect(deleteOwnAccount({ ...target, googleProof: token }, database)).rejects.toMatchObject({ status: 401 });
  });
  it('rechaza un sujeto Google distinto y una prueba caducada', async () => {
    const target = user();
    link(target.userId);
    const token = randomBytes(32).toString('base64url');
    await expect(saveDeletionProof({ ...target, token, googleSubject: 'otra-persona' }, database)).rejects.toMatchObject({ status: 403 });
    await saveDeletionProof({ ...target, token, googleSubject: `google-${target.userId}` }, database);
    database.raw.prepare('UPDATE account_deletion_proofs SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    await expect(deleteOwnAccount({ ...target, credentialHash: undefined, googleProof: token }, database)).rejects.toMatchObject({ status: 403 });
  });
});

describe('limpieza durable y referencias ajenas', () => {
  it('conserva una imagen referenciada por una prenda ajena', async () => {
    const target = user(); const other = user();
    const photo = image(target.userId);
    garment(other.userId, photo);
    await deleteOwnAccount(target, database);
    expect(await claimImageDeletionJob(photo, database)).toBeNull();
    expect(database.raw.prepare('SELECT state FROM image_deletion_jobs WHERE image_id=?').get(photo)).toEqual({ state: 'SHARED' });
  });
  it('conserva una copia con otra ID pero la misma clave de almacenamiento', async () => {
    const target = user(); const other = user();
    const photo = image(target.userId, 'my-closet-preview/synthetic-asset', 'cloudinary');
    image(other.userId, 'my-closet-preview/synthetic-asset', 'cloudinary');
    await deleteOwnAccount(target, database);
    expect(await claimImageDeletionJob(photo, database)).toBeNull();
  });
  it('bloquea nuevas referencias durante limpieza y conserva el trabajo al fallar', async () => {
    const target = user(); const other = user();
    const key = randomUUID(); const photo = image(target.userId, key);
    await deleteOwnAccount(target, database);
    expect(await claimImageDeletionJob(photo, database)).toMatchObject({ image_id: photo });
    expect(() => garment(other.userId, photo)).toThrow('IMAGE_DELETING');
    expect(() => image(other.userId, key)).toThrow('IMAGE_DELETING');
    expect(database.raw.prepare('SELECT state FROM image_deletion_jobs WHERE image_id=?').get(photo)).toEqual({ state: 'PROCESSING' });
    expect(database.raw.prepare('SELECT id FROM images WHERE id=?').get(photo)).toEqual({ id: photo });
  });
  it('completa idempotentemente y rechaza resucitar referencias después', async () => {
    const target = user(); const other = user(); const photo = image(target.userId);
    await deleteOwnAccount(target, database);
    await claimImageDeletionJob(photo, database);
    await finishImageDeletionJob(photo, database);
    await finishImageDeletionJob(photo, database);
    expect(database.raw.prepare('SELECT id FROM images WHERE id=?').get(photo)).toBeUndefined();
    expect(() => garment(other.userId, photo)).toThrow('IMAGE_DELETING');
    expect(await claimImageDeletionJob(photo, database)).toBeNull();
  });
});
