import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEntry, Garment, Outfit, WardrobeShare } from '@/lib/domain/types';
import { closeServerDB } from '@/server/db';
import {
  OwnershipError,
  pullAll,
  upsertCalendarEntry,
  upsertGarment,
  upsertOutfit,
  upsertWardrobeShare,
} from '@/server/repositories/sync-repository';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import type { SessionUser } from '@/server/auth/session';
import { getImageStorage, ImageOwnershipError } from '@/server/images/storage';
import {
  acceptWardrobeInvitation,
  inspectWardrobeInvitation,
} from '@/server/repositories/wardrobe-invitations-repository';

const USER_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER_B = 'aaaaaaaa-0000-4000-8000-000000000002';

function makeGarment(overrides: Partial<Garment> = {}): Garment {
  const now = new Date().toISOString();
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    userId: USER_A,
    shareableId: 'cccccccc-0000-4000-8000-000000000001',
    name: 'Vestido midi',
    category: 'dresses',
    colors: ['blue'],
    brand: 'Mango',
    size: 'M',
    notes: null,
    washingInstructions: null,
    dateAcquired: '2026-01-15',
    archived: false,
    favorite: false,
    photoId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
    syncStatus: 'pending',
    ...overrides,
  };
}

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
});

afterEach(async () => {
  await closeServerDB();
});

/** Inserta usuarios con ids fijos de prueba. */
async function seedUsers(): Promise<void> {
  const { getServerDB, sqliteSchema } = await import('@/server/db');
  const db = await getServerDB();
  if (db.dialect !== 'sqlite') {
    throw new Error('Esta prueba de integracion requiere SQLite');
  }
  await db.sqlite.insert(sqliteSchema.users).values([
    { id: USER_A, email: 'ana@test.local', displayName: 'Ana', passwordHash: 'hash-a' },
    { id: USER_B, email: 'beto@test.local', displayName: 'Beto', passwordHash: 'hash-b' },
  ]);
}

describe('repositorio de sincronización (SQLite)', () => {
  it('aplica un upsert nuevo y luego rechaza la versión vieja como conflicto', async () => {
    await seedUsers();
    const g1 = makeGarment();
    const applied = await upsertGarment(USER_A, g1);
    expect(applied.status).toBe('applied');

    // Otro dispositivo escribió una versión más nueva:
    const g2 = makeGarment({ version: 2, name: 'Vestido midi (editado)' });
    await upsertGarment(USER_A, g2);

    // Un push retrasado con la versión 1 no debe sobrescribir:
    const stale = makeGarment({ version: 1, name: 'Vestido original' });
    const outcome = await upsertGarment(USER_A, stale);
    expect(outcome.status).toBe('conflict');
    if (outcome.status === 'conflict') {
      expect(outcome.remote.version).toBe(2);
      expect(outcome.remote.name).toBe('Vestido midi (editado)');
    }
  });

  it('conserva favorita en el roundtrip de servidor', async () => {
    await seedUsers();
    const garment = makeGarment({ favorite: true });
    await upsertGarment(USER_A, garment);

    const pulled = await pullAll(USER_A, null);
    expect(pulled.garments[0]?.favorite).toBe(true);
  });

  it('pull trae entidades actualizadas después de `since`', async () => {
    await seedUsers();
    const g1 = makeGarment({ id: 'bbbbbbbb-0000-4000-8000-0000000000a1' });
    await upsertGarment(USER_A, g1);

    const outfit: Outfit = {
      id: 'bbbbbbbb-0000-4000-8000-0000000000b1',
      userId: USER_A,
      shareableId: 'cccccccc-0000-4000-8000-0000000000b1',
      name: 'Casual',
      notes: null,
      slots: [{ category: 'dresses', garmentId: g1.id }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      deletedAt: null,
      syncStatus: 'pending',
    };
    await upsertOutfit(USER_A, outfit);

    const since = new Date(Date.now() - 60_000).toISOString();
    const pulled = await pullAll(USER_A, since);
    expect(pulled.garments.map((g) => g.id)).toContain(g1.id);
    expect(pulled.outfits.map((o) => o.id)).toContain(outfit.id);
    expect(pulled.serverTime).toBeTruthy();

    // Nada nuevo en el futuro:
    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await pullAll(USER_A, future);
    expect(empty.garments).toHaveLength(0);
    expect(empty.outfits).toHaveLength(0);
  });

  it('pagina sin omitir ni duplicar entidades con la misma marca temporal', async () => {
    await seedUsers();
    const ids = [
      'bbbbbbbb-0000-4000-8000-0000000000c1',
      'bbbbbbbb-0000-4000-8000-0000000000c2',
      'bbbbbbbb-0000-4000-8000-0000000000c3',
    ];
    for (const id of ids) {
      await upsertGarment(USER_A, makeGarment({ id, shareableId: id.replace('bbbb', 'cccc') }));
    }

    const received: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await pullAll(USER_A, null, { cursor, limit: 1 });
      received.push(...page.garments.map((garment) => garment.id));
      cursor = page.nextCursor ?? undefined;
      expect(page.hasMore).toBe(Boolean(cursor));
    } while (cursor);

    expect(received).toEqual(ids);
    expect(new Set(received).size).toBe(ids.length);
  });

  it('usa reloj del servidor para incluir una escritura con reloj cliente adelantado', async () => {
    await seedUsers();
    const garment = makeGarment({
      id: 'bbbbbbbb-0000-4000-8000-0000000000d1',
      updatedAt: '2099-01-01T00:00:00.000Z',
    });
    await upsertGarment(USER_A, garment);

    const pulled = await pullAll(USER_A, new Date(Date.now() - 1_000).toISOString());
    expect(pulled.garments.map((item) => item.id)).toContain(garment.id);
  });

  it('mantiene tombstones y rechaza la reaparición de una copia antigua', async () => {
    await seedUsers();
    const original = makeGarment({ id: 'bbbbbbbb-0000-4000-8000-0000000000e1' });
    await upsertGarment(USER_A, original);
    const deletedAt = new Date().toISOString();
    const tombstone = makeGarment({
      ...original,
      version: 2,
      updatedAt: deletedAt,
      deletedAt,
    });
    await upsertGarment(USER_A, tombstone);

    const stale = makeGarment({
      ...original,
      version: 1,
      updatedAt: '2099-01-01T00:00:00.000Z',
      deletedAt: null,
    });
    await expect(upsertGarment(USER_A, stale)).resolves.toMatchObject({
      status: 'conflict',
      remote: { version: 2, deletedAt },
    });
    expect((await pullAll(USER_A, null)).garments).toContainEqual(
      expect.objectContaining({ id: original.id, version: 2, deletedAt }),
    );
  });

  it('reintentar todas las entidades no duplica registros', async () => {
    await seedUsers();
    const garment = makeGarment({ id: 'bbbbbbbb-0000-4000-8000-0000000000f1' });
    const outfit: Outfit = {
      id: 'bbbbbbbb-0000-4000-8000-0000000000f2',
      userId: USER_A,
      shareableId: 'cccccccc-0000-4000-8000-0000000000f2',
      name: 'Contrato',
      notes: null,
      slots: [{ category: 'tops', garmentId: garment.id }],
      createdAt: garment.createdAt,
      updatedAt: garment.updatedAt,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending',
    };
    const calendar: CalendarEntry = {
      id: 'bbbbbbbb-0000-4000-8000-0000000000f3',
      userId: USER_A,
      date: '2026-08-25',
      outfitId: outfit.id,
      wornAt: null,
      notes: null,
      createdAt: garment.createdAt,
      updatedAt: garment.updatedAt,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending',
    };
    const share: WardrobeShare = {
      id: 'bbbbbbbb-0000-4000-8000-0000000000f4',
      grantorId: USER_A,
      granteeId: null,
      granteeEmail: 'beto@test.local',
      permission: 'VIEW',
      inviteToken: '0123456789abcdef0123456789abcdef',
      acceptedAt: null,
      createdAt: garment.createdAt,
      updatedAt: garment.updatedAt,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending',
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await upsertGarment(USER_A, garment);
      await upsertOutfit(USER_A, outfit);
      await upsertCalendarEntry(USER_A, calendar);
      await upsertWardrobeShare(USER_A, share);
    }

    const pulled = await pullAll(USER_A, null);
    expect(pulled.garments.filter((item) => item.id === garment.id)).toHaveLength(1);
    expect(pulled.outfits.filter((item) => item.id === outfit.id)).toHaveLength(1);
    expect(pulled.calendarEntries.filter((item) => item.id === calendar.id)).toHaveLength(1);
    expect(pulled.wardrobeShares.filter((item) => item.id === share.id)).toHaveLength(1);
  });

  it('rechaza escribir una entidad que pertenece a otro usuario (IDOR)', async () => {
    await seedUsers();
    const g1 = makeGarment(); // pertenece a USER_A
    await upsertGarment(USER_A, g1);

    const hijack = makeGarment({ userId: USER_B, name: 'robado' });
    await expect(upsertGarment(USER_B, hijack)).rejects.toBeInstanceOf(OwnershipError);
  });

  it('aisla el pull por usuario', async () => {
    await seedUsers();
    await upsertGarment(USER_A, makeGarment());
    const pulledB = await pullAll(USER_B, null);
    expect(pulledB.garments).toHaveLength(0);
  });

  it('filtra metadatos de imagen por propietario y nunca incluye binario', async () => {
    await seedUsers();
    const storage = getImageStorage();
    const data = Buffer.from('RIFFxxxxWEBPpayload');
    await storage.put({
      id: 'dddddddd-0000-4000-8000-000000000001',
      userId: USER_A,
      data,
      mimeType: 'image/webp',
      width: 40,
      height: 50,
    });
    await storage.put({
      id: 'dddddddd-0000-4000-8000-000000000002',
      userId: USER_B,
      data,
      mimeType: 'image/webp',
      width: 60,
      height: 70,
    });

    const pulled = await pullAll(USER_A, null);
    expect(pulled.images).toHaveLength(1);
    expect(pulled.images[0]).toMatchObject({ userId: USER_A, width: 40, height: 50 });
    expect(JSON.stringify(pulled)).not.toContain('payload');
    expect(pulled.images[0]).not.toHaveProperty('data');
  });

  it('nunca reasigna un id de imagen existente a otro usuario', async () => {
    await seedUsers();
    const storage = getImageStorage();
    const input = {
      id: 'dddddddd-0000-4000-8000-000000000003',
      userId: USER_A,
      data: Buffer.from('RIFFxxxxWEBPpayload'),
      mimeType: 'image/webp',
      width: 40,
      height: 50,
    };
    await storage.put(input);

    await expect(storage.put({ ...input, userId: USER_B })).rejects.toBeInstanceOf(ImageOwnershipError);
    expect((await pullAll(USER_A, null)).images).toHaveLength(1);
    expect((await pullAll(USER_B, null)).images).toHaveLength(0);
  });

  it('acepta una invitación de armario por correo de forma atómica e idempotente', async () => {
    await seedUsers();
    const now = new Date().toISOString();
    const share: WardrobeShare = {
      id: 'bbbbbbbb-0000-4000-8000-0000000000f5',
      grantorId: USER_A,
      granteeId: null,
      granteeEmail: 'beto@test.local',
      permission: 'MANAGE',
      inviteToken: 'abcdef0123456789abcdef0123456789',
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending',
    };
    await upsertWardrobeShare(USER_A, share);
    const beto: SessionUser = {
      userId: USER_B,
      email: 'BETO@test.local',
      displayName: 'Beto',
      createdAt: now,
      role: 'USER',
      status: 'ACTIVE',
      profileImageId: null,
    };

    await expect(inspectWardrobeInvitation(share.inviteToken, beto)).resolves.toEqual({
      permission: 'MANAGE',
      accepted: false,
    });
    await expect(acceptWardrobeInvitation(share.inviteToken, beto)).resolves.toEqual({
      permission: 'MANAGE',
      accepted: true,
    });
    await expect(acceptWardrobeInvitation(share.inviteToken, beto)).resolves.toEqual({
      permission: 'MANAGE',
      accepted: true,
    });

    const pulledByGrantee = await pullAll(USER_B, null);
    expect(pulledByGrantee.wardrobeShares).toEqual([
      expect.objectContaining({ id: share.id, granteeId: USER_B, version: 2 }),
    ]);

    await expect(inspectWardrobeInvitation(share.inviteToken, {
      ...beto,
      userId: 'aaaaaaaa-0000-4000-8000-000000000003',
      email: 'otra@test.local',
    })).rejects.toMatchObject({ code: 'EMAIL_MISMATCH' });
  });
});

describe('password hashing', () => {
  it('hashea y verifica correctamente', async () => {
    const hash = await hashPassword('s3creta-Contraseña');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3creta-Contraseña', hash)).toBe(true);
    expect(await verifyPassword('incorrecta', hash)).toBe(false);
  });

  it('produce hashes distintos por sal', async () => {
    const h1 = await hashPassword('misma');
    const h2 = await hashPassword('misma');
    expect(h1).not.toBe(h2);
  });
});
