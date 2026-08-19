import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Garment, Outfit } from '@/lib/domain/types';
import { closeServerDB } from '@/server/db';
import {
  OwnershipError,
  pullAll,
  upsertGarment,
  upsertOutfit,
} from '@/server/repositories/sync-repository';
import { hashPassword, verifyPassword } from '@/server/auth/password';

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
