import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { closeServerDB, createServerDB, getServerDB, pgSchema } from '@/server/db';
import { getEnv } from '@/server/env';
import { rateLimit } from '@/server/auth/rate-limit';
import { createHmac } from 'node:crypto';
import { getAuthSecret } from '@/server/env';
import {
  createUser,
  findUserByEmail,
  updateProfile,
} from '@/server/repositories/users-repository';
import {
  findGoogleAccountByUserId,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import {
  pullAll,
  upsertCalendarEntry,
  upsertGarment,
  upsertOutfit,
  upsertWardrobeShare,
} from '@/server/repositories/sync-repository';
import { getImageStorage } from '@/server/images/storage';
import {
  acceptWardrobeInvitation,
  inspectWardrobeInvitation,
} from '@/server/repositories/wardrobe-invitations-repository';

const enabled = process.env.DATABASE_PROVIDER === 'postgres' && Boolean(process.env.DATABASE_URL);
const describePostgres = enabled ? describe : describe.skip;
const cleanupUserIds: string[] = [];

describePostgres('contrato de repositorios PostgreSQL', () => {
  it('comparte límites atómicos entre dos conexiones independientes', async () => {
    const first = await getServerDB();
    const second = await createServerDB({ ...getEnv(), BOOTSTRAP_ADMIN_EMAIL: undefined, BOOTSTRAP_ADMIN_PASSWORD: undefined });
    if (first.dialect !== 'postgres' || second.dialect !== 'postgres') throw new Error('Contrato requiere PostgreSQL');
    const key = `contract-rate-${uuid()}`;
    // Una ventana larga evita que el cambio de minuto vuelva frágil esta prueba.
    const windowMs = 86_400_000;
    const keyHash = createHmac('sha256', getAuthSecret()).update(JSON.stringify([key, 5, windowMs])).digest('hex');
    try {
      const attempts = await Promise.all(Array.from({ length: 30 }, (_, index) =>
        rateLimit(key, 5, windowMs, index % 2 ? first : second)));
      expect(attempts.filter(Boolean)).toHaveLength(5);
      expect(await second.postgres.select({ hits: pgSchema.rateLimitBuckets.hits }).from(pgSchema.rateLimitBuckets)
        .where(eq(pgSchema.rateLimitBuckets.keyHash, keyHash))).toEqual([{ hits: 5 }]);
    } finally {
      await first.postgres.delete(pgSchema.rateLimitBuckets).where(inArray(pgSchema.rateLimitBuckets.keyHash, [keyHash]));
      await second.raw.end({ timeout: 5 });
    }
  });
  afterAll(async () => {
    const db = await getServerDB();
    if (db.dialect === 'postgres' && cleanupUserIds.length > 0) {
      for (const userId of cleanupUserIds) {
        await db.postgres.delete(pgSchema.users).where(eq(pgSchema.users.id, userId));
      }
    }
    await closeServerDB();
  });

  it('pagina imágenes con microsegundos sin omisiones ni duplicados', async () => {
    const user = await createUser({ email: `precision-${uuid()}@example.test`, displayName: 'Precisión', passwordHash: 'scrypt:test-contract' });
    cleanupUserIds.push(user.id);
    const db = await getServerDB();
    if (db.dialect !== 'postgres') throw new Error('Se esperaba PostgreSQL');
    const base = new Date(Date.now() - 1000).toISOString().slice(0, 19);
    const ids = [uuid(), uuid(), uuid()].sort();
    const stamps = [`${base}.123456Z`, `${base}.123789Z`, `${base}.123789Z`];
    for (const [index, id] of ids.entries()) {
      await db.postgres.insert(pgSchema.images).values({
        id, userId: user.id, mimeType: 'image/webp', width: 1, height: 1, byteSize: 1,
        data: null, storageProvider: 'cloudinary', remoteUrl: `https://example.test/${id}.webp`,
        updatedAt: sql`${stamps[index]}::timestamptz`,
      });
    }
    const received: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const page = await pullAll(user.id, null, { cursor, limit: 1 });
      expect(page.serverTime).toMatch(/\.\d{6}Z$/);
      received.push(...page.images.map(image => image.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(received).toEqual(ids);
  });

  it('crea, consulta y actualiza una cuenta', async () => {
    const suffix = uuid();
    const user = await createUser({
      email: `contract-${suffix}@example.test`,
      displayName: 'Contrato PostgreSQL',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(user.id);

    expect(await findUserByEmail(user.email)).toMatchObject({
      id: user.id,
      displayName: 'Contrato PostgreSQL',
    });
    expect(await updateProfile(user.id, { displayName: 'Contrato actualizado' }))
      .toMatchObject({ displayName: 'Contrato actualizado' });
  });

  it('vincula Google explícitamente y sincroniza una prenda', async () => {
    const suffix = uuid();
    const user = await createUser({
      email: `google-${suffix}@example.test`,
      displayName: 'Google Contract',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(user.id);

    const linked = await linkGoogleAccount({
      userId: user.id,
      providerSubject: `subject-${suffix}`,
      providerEmail: user.email,
    });
    expect(await findGoogleAccountByUserId(user.id)).toMatchObject({ id: linked.id });
    expect(await unlinkGoogleAccount(user.id)).toBe(true);

    const now = new Date().toISOString();
    const garment = {
      id: uuid(),
      userId: user.id,
      shareableId: uuid(),
      name: 'Prenda contrato',
      category: 'TOP' as const,
      colors: ['NEGRO'],
      brand: null,
      size: null,
      notes: null,
      washingInstructions: null,
      dateAcquired: null,
      archived: false,
      favorite: true,
      photoId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };
    expect(await upsertGarment(user.id, garment)).toMatchObject({ status: 'applied' });
    const pulled = await pullAll(user.id, null);
    expect(pulled.garments).toContainEqual(expect.objectContaining({ id: garment.id }));
  });

  it('conserva el contrato completo, imágenes mixtas, paginación y tombstones', async () => {
    const suffix = uuid();
    const user = await createUser({
      email: `sync-${suffix}@example.test`,
      displayName: 'Sync Contract',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(user.id);
    const grantee = await createUser({
      email: `grantee-${suffix}@example.test`,
      displayName: 'Grantee Contract',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(grantee.id);
    const now = new Date().toISOString();
    const garment = {
      id: uuid(),
      userId: user.id,
      shareableId: uuid(),
      name: 'Prenda PostgreSQL',
      category: 'tops',
      colors: ['negro'],
      brand: null,
      size: null,
      notes: null,
      washingInstructions: null,
      dateAcquired: null,
      archived: false,
      favorite: false,
      photoId: null,
      createdAt: now,
      updatedAt: '2099-01-01T00:00:00.000Z',
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };
    const outfit = {
      id: uuid(),
      userId: user.id,
      shareableId: uuid(),
      name: 'Conjunto PostgreSQL',
      notes: null,
      slots: [{ category: 'tops', garmentId: garment.id }],
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };
    const calendar = {
      id: uuid(),
      userId: user.id,
      date: '2026-08-25',
      outfitId: outfit.id,
      wornAt: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };
    const share = {
      id: uuid(),
      grantorId: user.id,
      granteeId: null,
      granteeEmail: grantee.email,
      permission: 'VIEW' as const,
      inviteToken: 'abcdef0123456789abcdef0123456789',
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await upsertGarment(user.id, garment);
      await upsertOutfit(user.id, outfit);
      await upsertCalendarEntry(user.id, calendar);
      await upsertWardrobeShare(user.id, share);
    }

    const storage = getImageStorage();
    const localImageId = uuid();
    await storage.put({
      id: localImageId,
      userId: user.id,
      data: Buffer.from('RIFFxxxxWEBPcontract'),
      mimeType: 'image/webp',
      width: 10,
      height: 20,
    });
    const cloudImageId = uuid();
    const db = await getServerDB();
    if (db.dialect !== 'postgres') throw new Error('Se esperaba PostgreSQL');
    await db.postgres.insert(pgSchema.images).values({
      id: cloudImageId,
      userId: user.id,
      mimeType: 'image/webp',
      width: 30,
      height: 40,
      byteSize: 500,
      data: null,
      remoteUrl: `https://res.cloudinary.com/demo/image/upload/${cloudImageId}.webp`,
      storageProvider: 'cloudinary',
      storageKey: `my-closet/${user.id}/${cloudImageId}`,
    });

    const received = { garments: 0, outfits: 0, calendarEntries: 0, wardrobeShares: 0, images: 0 };
    let cursor: string | undefined;
    do {
      const page = await pullAll(user.id, null, { cursor, limit: 1 });
      received.garments += page.garments.length;
      received.outfits += page.outfits.length;
      received.calendarEntries += page.calendarEntries.length;
      received.wardrobeShares += page.wardrobeShares.length;
      received.images += page.images.length;
      expect(JSON.stringify(page.images)).not.toContain('contract');
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(received).toEqual({
      garments: 1,
      outfits: 1,
      calendarEntries: 1,
      wardrobeShares: 1,
      images: 2,
    });

    const granteePrincipal = {
      userId: grantee.id,
      email: grantee.email,
      displayName: grantee.displayName,
      createdAt: grantee.createdAt,
      role: grantee.role,
      status: grantee.status,
      profileImageId: grantee.profileImageId,
    };
    await expect(inspectWardrobeInvitation(share.inviteToken, granteePrincipal))
      .resolves.toEqual({ permission: 'VIEW', accepted: false });
    await expect(acceptWardrobeInvitation(share.inviteToken, granteePrincipal))
      .resolves.toEqual({ permission: 'VIEW', accepted: true });
    await expect(acceptWardrobeInvitation(share.inviteToken, granteePrincipal))
      .resolves.toEqual({ permission: 'VIEW', accepted: true });
    expect((await pullAll(grantee.id, null)).wardrobeShares).toEqual([
      expect.objectContaining({ id: share.id, granteeId: grantee.id, version: 2 }),
    ]);

    const deletedAt = new Date().toISOString();
    await upsertGarment(user.id, {
      ...garment,
      version: 2,
      updatedAt: deletedAt,
      deletedAt,
    });
    await expect(upsertGarment(user.id, garment)).resolves.toMatchObject({
      status: 'conflict',
      remote: { version: 2, deletedAt },
    });
  });
});
