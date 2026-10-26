import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createServerDB, pgSchema, type ServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import { credentialFingerprint } from '@/server/repositories/email-change-repository';
import { claimImageDeletionJob, deleteOwnAccount, deletionDigest, finishImageDeletionJob, saveDeletionProof, validDeletionProof } from '@/server/repositories/account-deletion-repository';

type Database = Extract<ServerDB, { dialect: 'postgres' }>;
let first: Database;
let second: Database;
const users: string[] = [];
const images: string[] = [];
let keeperId: string;
const suite = process.env.ACCOUNT_DELETION_CONTRACT_DATABASE_URL ? describe : describe.skip;

suite('baja PostgreSQL en base sintética aislada', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const uri = new URL(process.env.ACCOUNT_DELETION_CONTRACT_DATABASE_URL!);
    const host = uri.hostname.replace('-pooler', '');
    if (!process.env.INVITATION_CONTRACT_EXPECTED_HOST || !process.env.INVITATION_CONTRACT_PRODUCTION_HOST
      || host !== process.env.INVITATION_CONTRACT_EXPECTED_HOST || host === process.env.INVITATION_CONTRACT_PRODUCTION_HOST
      || uri.pathname !== '/closet_5c_preview' || uri.username !== 'closet_5c_preview_owner') {
      throw new Error('Destino rechazado: solo base y rol de pruebas 5C');
    }
    const env = parseServerEnv({ NODE_ENV: 'test', DATABASE_PROVIDER: 'postgres', DATABASE_URL: uri.toString(), IMAGE_PROVIDER: 'local' });
    const a = await createServerDB(env);
    const b = await createServerDB(env);
    if (a.dialect !== 'postgres' || b.dialect !== 'postgres') throw new Error('Contrato requiere PostgreSQL');
    first = a; second = b;
    const [existing] = await first.raw`SELECT id FROM users WHERE role='ADMIN' AND status='ACTIVE' ORDER BY id LIMIT 1`;
    keeperId = typeof existing?.id === 'string' ? existing.id : randomUUID();
    if (!existing) await first.raw`INSERT INTO users(id,email,display_name,password_hash,role,admin_slot)
      VALUES(${keeperId},'keeper-5c@example.test','Administrador sintético','unusable-fixture','ADMIN',1)`;
  });
  afterEach(async () => {
    if (!first) return;
    // Respect the real last-admin trigger during fixture cleanup too.
    const [keeper] = await first.raw`SELECT role FROM users WHERE id=${keeperId}`;
    if (keeper?.role !== 'ADMIN') {
      const active = await first.raw`SELECT id,admin_slot FROM users WHERE role='ADMIN' AND status='ACTIVE' ORDER BY id`;
      if (active.length >= 2 && typeof active[0]?.id === 'string' && users.includes(active[0].id)) {
        await first.raw`UPDATE users SET role='USER',admin_slot=NULL WHERE id=${active[0].id}`;
      }
      const [free] = await first.raw`SELECT s AS slot FROM generate_series(1,2) s WHERE NOT EXISTS(SELECT 1 FROM users WHERE admin_slot=s) LIMIT 1`;
      if (!free) throw new Error('No free fixture slot');
      await first.raw`UPDATE users SET role='ADMIN',status='ACTIVE',admin_slot=${free.slot} WHERE id=${keeperId}`;
    }
    if (images.length) await first.postgres.delete(pgSchema.imageDeletionJobs).where(inArray(pgSchema.imageDeletionJobs.imageId, images));
    if (users.length) {
      await first.postgres.delete(pgSchema.accountDeletionProofs).where(inArray(pgSchema.accountDeletionProofs.userId, users));
      await first.postgres.delete(pgSchema.users).where(inArray(pgSchema.users.id, users));
      await first.postgres.delete(pgSchema.accountDeletions).where(inArray(pgSchema.accountDeletions.userId, users));
    }
    users.length = 0; images.length = 0;
  });
  afterAll(async () => { if (first) await first.raw.end({ timeout: 5 }); if (second) await second.raw.end({ timeout: 5 }); });

  async function account(role: 'USER' | 'ADMIN' = 'USER', slot: number | null = null) {
    const userId = randomUUID(); users.push(userId);
    const passwordHash = 'synthetic-pg-credential';
    await first.raw`INSERT INTO users(id,email,display_name,password_hash,role,admin_slot)
      VALUES(${userId},${`${userId}@example.test`},'Sintético',${passwordHash},${role},${slot})`;
    const sessionId = randomBytes(32).toString('hex');
    await first.raw`INSERT INTO sessions(id,user_id,expires_at) VALUES(${sessionId},${userId},'2099-01-01T00:00:00Z')`;
    return { userId, sessionId, sessionHash: deletionDigest('session', sessionId), credentialHash: credentialFingerprint(passwordHash) };
  }
  async function image(userId: string) {
    const id = randomUUID(); images.push(id);
    await first.raw`INSERT INTO images(id,user_id,mime_type,byte_size,data,storage_provider,storage_key)
      VALUES(${id},${userId},'image/webp',1,'AQ==','local',${id})`;
    return id;
  }
  async function garment(database: Database, userId: string, photoId: string | null = null) {
    const now = new Date().toISOString();
    await database.raw`INSERT INTO garments(id,user_id,shareable_id,category,photo_id,created_at,updated_at,server_updated_at)
      VALUES(${randomUUID()},${userId},${randomUUID()},'tops',${photoId},${now},${now},${now})`;
  }
  it('dos bajas ADMIN concurrentes conservan exactamente un administrador activo', async () => {
    const [keeper] = await first.raw`SELECT admin_slot FROM users WHERE id=${keeperId}`;
    const keeperSlot = Number(keeper?.admin_slot);
    const a = await account('ADMIN', keeperSlot === 1 ? 2 : 1);
    await first.raw`UPDATE users SET role='USER',admin_slot=NULL WHERE id=${keeperId}`;
    const b = await account('ADMIN', keeperSlot);
    const results = await Promise.allSettled([deleteOwnAccount(a, first), deleteOwnAccount(b, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ status: 409 });
    const [row] = await first.raw`SELECT count(*)::int AS count FROM users WHERE role='ADMIN' AND status='ACTIVE'`;
    expect(row?.count).toBe(1);
  });
  it('las escrituras concurrentes no sobreviven a la baja y no se puede reactivar la cuenta', async () => {
    const target = await account();
    const outcomes = await Promise.allSettled([deleteOwnAccount(target, first), ...Array.from({ length: 6 }, () => garment(second, target.userId))]);
    expect(outcomes[0]?.status).toBe('fulfilled');
    const [row] = await first.raw`SELECT count(*)::int AS count FROM garments WHERE user_id=${target.userId}`;
    expect(row?.count).toBe(0);
    await expect(garment(second, target.userId)).rejects.toMatchObject({ code: '23514' });
    await expect(second.raw`UPDATE users SET status='ACTIVE' WHERE id=${target.userId}`).rejects.toMatchObject({ code: '23514' });
  });
  it('conserva imágenes referenciadas por otra cuenta', async () => {
    const target = await account(); const other = await account();
    const photo = await image(target.userId);
    await garment(second, other.userId, photo);
    await deleteOwnAccount(target, first);
    expect(await claimImageDeletionJob(photo, second)).toBeNull();
    const [job] = await first.raw`SELECT state FROM image_deletion_jobs WHERE image_id=${photo}`;
    expect(job?.state).toBe('SHARED');
  });
  it('los triggers bloquean nuevas referencias durante y después de la limpieza', async () => {
    const target = await account(); const other = await account();
    const photo = await image(target.userId);
    await deleteOwnAccount(target, first);
    expect(await claimImageDeletionJob(photo, first)).not.toBeNull();
    await expect(garment(second, other.userId, photo)).rejects.toMatchObject({ code: '23514' });
    await finishImageDeletionJob(photo, first);
    await finishImageDeletionJob(photo, second);
    await expect(garment(second, other.userId, photo)).rejects.toMatchObject({ code: '23514' });
  });
  it('liga la prueba Google a sesión y sujeto y la consume al eliminar', async () => {
    const target = await account();
    await first.raw`INSERT INTO auth_accounts(id,user_id,provider,provider_subject,provider_email)
      VALUES(${randomUUID()},${target.userId},'GOOGLE','synthetic-google-subject','synthetic@example.test')`;
    const token = randomBytes(32).toString('base64url');
    await saveDeletionProof({ ...target, token, googleSubject: 'synthetic-google-subject' }, first);
    expect(await validDeletionProof(target.userId, token, 'other-session', second)).toBe(false);
    expect(await validDeletionProof(target.userId, token, target.sessionHash, second)).toBe(true);
    await deleteOwnAccount({ ...target, credentialHash: undefined, googleProof: token }, second);
    expect(await validDeletionProof(target.userId, token, target.sessionHash, first)).toBe(false);
  });
});
