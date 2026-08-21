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
  toggleGarmentFavorite,
  updateGarment,
} from '@/lib/local/repositories';
import type { Garment } from '@/lib/domain/types';
import { filterGarments, EMPTY_FILTERS } from '@/lib/local/queries';
import { applyRemoteImageMetadata } from '@/lib/local/sync-engine';
import { replaceAdminInvitations, replaceAdminUsers } from '@/lib/local/admin-cache';
import {
  clearLocalProfile,
  clearRecommendationContext,
  getRecommendationContext,
  setLocalProfile,
  setRecommendationContext,
} from '@/lib/local/kv';

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
    db.adminUsers.clear(),
    db.adminInvitations.clear(),
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
    expect(stored).toMatchObject({
      name: 'Vestido azul',
      favorite: false,
      version: 1,
      syncStatus: 'pending',
    });

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

  it('alternar favorita persiste y encola el snapshot en la misma escritura', async () => {
    const garment = await createGarment(USER, { name: 'Favorita', category: 'tops', colors: [] });
    const toggled = await toggleGarmentFavorite(garment.id);

    expect(toggled).toMatchObject({ favorite: true, version: 2, syncStatus: 'pending' });
    expect((await getDB().garments.get(garment.id))?.favorite).toBe(true);
    const operations = await getDB().outbox.where('entityId').equals(garment.id).toArray();
    expect(operations).toHaveLength(2);
    expect(operations.some((operation) => {
      const payload = operation.payload as { favorite?: boolean; version?: number };
      return payload.favorite === true && payload.version === 2;
    })).toBe(true);
  });

  it('filtra solo favoritas cuando se activa el campo de consulta', async () => {
    const favorite = await createGarment(USER, { name: 'Sí', category: 'tops', colors: [], favorite: true });
    await createGarment(USER, { name: 'No', category: 'tops', colors: [] });
    const garments = await getDB().garments.toArray();

    expect(filterGarments(garments, { ...EMPTY_FILTERS, favoriteOnly: true })).toEqual([favorite]);
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

describe('metadatos locales de imagen', () => {
  it('fusiona metadatos remotos conservando el blob local', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const blob = new Blob(['local'], { type: 'image/webp' });
    await getDB().images.put({
      id,
      userId: USER,
      mimeType: 'image/webp',
      width: 20,
      height: 30,
      byteSize: blob.size,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      blob,
      remoteUrl: null,
      storageProvider: 'local',
      storageKey: null,
      syncStatus: 'pending',
    });

    await applyRemoteImageMetadata({
      id,
      userId: USER,
      mimeType: 'image/webp',
      width: 20,
      height: 30,
      byteSize: blob.size,
      remoteUrl: `/api/images/${id}`,
      storageProvider: 'local',
      storageKey: id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const merged = await getDB().images.get(id);
    expect(merged?.blob).toMatchObject({ size: blob.size, type: blob.type });
    expect(await merged?.blob?.text()).toBe('local');
    expect(merged).toMatchObject({ remoteUrl: `/api/images/${id}`, syncStatus: 'synced' });
  });
});

describe('caché administrativa local', () => {
  it('reemplaza read models y los elimina al degradar rol o cerrar sesión', async () => {
    const profile = {
      userId: USER,
      email: 'admin@example.test',
      displayName: 'Admin',
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'ADMIN' as const,
      profileImageId: null,
    };
    await setLocalProfile(profile);
    await replaceAdminUsers([{
      ...profile,
      status: 'ACTIVE',
      adminSlot: 1,
    }]);
    await replaceAdminInvitations([{
      id: '33333333-3333-4333-8333-333333333333',
      email: 'invitee@example.test',
      role: 'USER',
      createdBy: USER,
      expiresAt: '2026-12-01T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      acceptedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    expect(await getDB().adminUsers.count()).toBe(1);
    expect(await getDB().adminInvitations.count()).toBe(1);

    await setLocalProfile({ ...profile, role: 'USER' });
    expect(await getDB().adminUsers.count()).toBe(0);
    expect(await getDB().adminInvitations.count()).toBe(0);

    await replaceAdminUsers([{ ...profile, status: 'ACTIVE', adminSlot: 1 }]);
    await replaceAdminInvitations([{
      id: '33333333-3333-4333-8333-333333333333',
      email: 'invitee@example.test',
      role: 'USER',
      createdBy: USER,
      expiresAt: '2026-12-01T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      acceptedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    await clearLocalProfile();
    expect(await getDB().adminUsers.count()).toBe(0);
    expect(await getDB().adminInvitations.count()).toBe(0);
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

describe('contexto local de recomendaciones', () => {
  it('persiste por usuario, valida al leer y no crea operaciones de outbox', async () => {
    const context = { occasion: 'work', temperature: 'cold', rain: true, style: 'classic' } as const;
    await setRecommendationContext(USER, context);

    expect(await getRecommendationContext(USER)).toEqual(context);
    expect(await getRecommendationContext(OTHER)).toBeNull();
    expect(await getDB().outbox.count()).toBe(0);

    await getDB().kv.put({ key: `recommendations:context:${OTHER}`, value: { occasion: 'invalid' } });
    expect(await getRecommendationContext(OTHER)).toBeNull();

    await clearRecommendationContext(USER);
    expect(await getRecommendationContext(USER)).toBeNull();
    expect(await getDB().outbox.count()).toBe(0);
  });
});
