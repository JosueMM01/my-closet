import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDB } from '@/lib/local/db';
import { claimPendingOperations, countPending } from '@/lib/local/outbox';
import {
  applyRemoteGarment,
  archiveGarment,
  cloneGarment,
  createGarment,
  createOutfit,
  deleteGarment,
  updateGarment,
} from '@/lib/local/repositories';
import type { Garment } from '@/lib/domain/types';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  const db = getDB();
  await Promise.all([
    db.garments.clear(),
    db.outfits.clear(),
    db.calendarEntries.clear(),
    db.wardrobeShares.clear(),
    db.images.clear(),
    db.outbox.clear(),
    db.kv.clear(),
  ]);
});

describe('repositorio local de prendas', () => {
  it('crear persiste la prenda y encola upsert en la outbox', async () => {
    const garment = await createGarment(USER, {
      name: 'Vestido azul',
      category: 'dresses',
      colors: ['blue'],
      brand: 'Zara',
      size: 'M',
      notes: null,
      washingInstructions: null,
      dateAcquired: null,
      archived: false,
      photoId: null,
    });

    const stored = await getDB().garments.get(garment.id);
    expect(stored).toMatchObject({ name: 'Vestido azul', version: 1, syncStatus: 'pending' });

    expect(await countPending()).toBe(1);
    const op = await getDB().outbox.toArray();
    expect(op[0]).toMatchObject({
      userId: USER,
      entityType: 'garment',
      entityId: garment.id,
      operation: 'upsert',
      status: 'pending',
    });
  });

  it('actualizar incrementa versión y genera otra operación', async () => {
    const garment = await createGarment(USER, {
      name: 'Falda',
      category: 'bottoms',
      colors: [],
    });
    const updated = await updateGarment(garment.id, { name: 'Falda plisada' });

    expect(updated?.version).toBe(2);
    expect(updated?.name).toBe('Falda plisada');
    expect(await countPending()).toBe(2);
  });

  it('archivar es un update parcial', async () => {
    const garment = await createGarment(USER, {
      name: 'Camiseta',
      category: 'tops',
      colors: [],
    });
    const archived = await archiveGarment(garment.id, true);
    expect(archived?.archived).toBe(true);
    expect(archived?.version).toBe(2);
  });

  it('clonar crea una copia con nuevo id y foto compartida', async () => {
    const original = await createGarment(USER, {
      name: 'Blazer',
      category: 'outerwear',
      colors: ['black'],
      photoId: '33333333-3333-4333-8333-333333333333',
    });
    const clone = await cloneGarment(original.id);
    expect(clone).not.toBeNull();
    if (!clone) return;

    expect(clone.id).not.toBe(original.id);
    expect(clone.name).toBe('Blazer (copia)');
    expect(clone.photoId).toBe(original.photoId);
    expect(clone.version).toBe(1);
  });

  it('eliminar genera tombstone y operación delete', async () => {
    const garment = await createGarment(USER, {
      name: 'Bufanda',
      category: 'accessories',
      colors: [],
    });
    expect(await deleteGarment(garment.id)).toBe(true);

    const tombstone = await getDB().garments.get(garment.id);
    expect(tombstone?.deletedAt).not.toBeNull();

    const ops = await getDB().outbox.toArray();
    expect(ops.some((op) => op.operation === 'delete' && op.entityId === garment.id)).toBe(true);
  });

  it('eliminar dos veces devuelve false (idempotente)', async () => {
    const garment = await createGarment(USER, { name: 'X', category: 'other', colors: [] });
    expect(await deleteGarment(garment.id)).toBe(true);
    expect(await deleteGarment(garment.id)).toBe(false);
  });

  it('applyRemote no sobrescribe una copia local más nueva', async () => {
    const local = await createGarment(USER, {
      name: 'Local nuevo',
      category: 'tops',
      colors: [],
    });
    await updateGarment(local.id, { name: 'Local aún más nuevo' }); // version 2

    const remoteStale: Garment = {
      ...local,
      name: 'Remoto viejo',
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      syncStatus: 'synced',
    };
    expect(await applyRemoteGarment(remoteStale)).toBe(false);
    expect((await getDB().garments.get(local.id))?.name).toBe('Local aún más nuevo');

    const remoteNewer: Garment = {
      ...local,
      name: 'Remoto ganador',
      version: 10,
      updatedAt: '2026-06-01T00:00:00.000Z',
      syncStatus: 'synced',
    };
    expect(await applyRemoteGarment(remoteNewer)).toBe(true);
    expect((await getDB().garments.get(local.id))?.name).toBe('Remoto ganador');
  });

  it('aisla datos por usuario vía consulta userId', async () => {
    await createGarment(USER, { name: 'Mía', category: 'tops', colors: [] });
    await createGarment(OTHER, { name: 'Ajena', category: 'tops', colors: [] });

    const mine = await getDB().garments.where('userId').equals(USER).toArray();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe('Mía');
  });

  it('solo reclama operaciones de la cuenta que sincroniza', async () => {
    await createGarment(USER, { name: 'Mía', category: 'tops', colors: [] });
    await createGarment(OTHER, { name: 'Ajena', category: 'tops', colors: [] });

    const claimed = await claimPendingOperations(50, USER);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.userId).toBe(USER);
    expect(await countPending(OTHER)).toBe(1);
  });
});

describe('repositorio local de outfits', () => {
  it('crea outfit con slots ordenados', async () => {
    const outfit = await createOutfit(USER, {
      name: 'Fin de semana',
      notes: null,
      slots: [
        { category: 'tops', garmentId: null },
        { category: 'bottoms', garmentId: null },
      ],
    });
    expect(outfit.slots).toHaveLength(2);
    expect(await countPending()).toBe(1);
  });
});
