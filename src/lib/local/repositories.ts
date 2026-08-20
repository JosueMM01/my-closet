/**
 * Repositorios locales: toda escritura aplica en IndexedDB primero
 * (optimista) y encola la operación en la outbox.
 */
import {
  garmentInputSchema,
  calendarEntryInputSchema,
  outfitInputSchema,
  permissionSchema,
  type CalendarEntryInputDraft,
  type GarmentInputDraft,
  type OutfitInputDraft,
} from '@/lib/domain/validation';
import { nextWrite, shouldApplyRemote } from '@/lib/domain/conflict';
import type { GarmentInput } from '@/lib/domain/validation';
import { inviteToken, uuid } from '@/lib/domain/ids';
import type {
  CalendarEntry,
  Garment,
  OutboxEntityType,
  Outfit,
  Permission,
  SyncEntity,
  WardrobeShare,
} from '@/lib/domain/types';
import { getDB } from './db';
import { enqueueOperation } from './outbox';

type SyncedEntity = SyncEntity;

/**
 * Transacción local: persistir entidad + encolar outbox atómicamente.
 */
async function persistAndEnqueue<E extends SyncedEntity>(
  entityType: OutboxEntityType,
  entity: E,
  operation: 'upsert' | 'delete',
): Promise<E> {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.garments, db.outfits, db.calendarEntries, db.wardrobeShares, db.outbox],
    async () => {
      switch (entityType) {
        case 'garment':
          await db.garments.put(entity as unknown as Garment);
          break;
        case 'outfit':
          await db.outfits.put(entity as unknown as Outfit);
          break;
        case 'calendarEntry':
          await db.calendarEntries.put(entity as unknown as CalendarEntry);
          break;
        case 'wardrobeShare':
          await db.wardrobeShares.put(entity as unknown as WardrobeShare);
          break;
      }
      const userId = entityType === 'wardrobeShare'
        ? (entity as unknown as WardrobeShare).grantorId
        : (entity as unknown as Garment | Outfit | CalendarEntry).userId;
      await enqueueOperation({ userId, entityType, entityId: entity.id, operation, payload: entity });
    },
  );
  return entity;
}

function baseEntity(): Pick<SyncEntity, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'deletedAt' | 'syncStatus'> {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
    syncStatus: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Garments
// ---------------------------------------------------------------------------

export async function createGarment(userId: string, input: GarmentInputDraft): Promise<Garment> {
  const data = garmentInputSchema.parse(input);
  const garment: Garment = {
    ...baseEntity(),
    userId,
    shareableId: uuid(),
    name: data.name,
    category: data.category,
    colors: data.colors,
    brand: data.brand,
    size: data.size,
    notes: data.notes,
    washingInstructions: data.washingInstructions,
    dateAcquired: data.dateAcquired,
    archived: data.archived,
    favorite: data.favorite,
    photoId: data.photoId,
  };
  return persistAndEnqueue('garment', garment, 'upsert');
}

export async function updateGarment(id: string, patch: Partial<GarmentInputDraft>): Promise<Garment | null> {
  const db = getDB();
  const existing = await db.garments.get(id);
  if (!existing || existing.deletedAt) return null;
  const merged = garmentInputSchema.parse({ ...toGarmentInput(existing), ...patch });
  const { version, updatedAt } = nextWrite(existing);
  const updated: Garment = {
    ...existing,
    ...merged,
    version,
    updatedAt,
    syncStatus: 'pending',
  };
  return persistAndEnqueue('garment', updated, 'upsert');
}

export async function archiveGarment(id: string, archived: boolean): Promise<Garment | null> {
  return updateGarment(id, { archived });
}

export async function setGarmentFavorite(id: string, favorite: boolean): Promise<Garment | null> {
  return updateGarment(id, { favorite });
}

export async function toggleGarmentFavorite(id: string): Promise<Garment | null> {
  const existing = await getDB().garments.get(id);
  if (!existing || existing.deletedAt) return null;
  return setGarmentFavorite(id, !existing.favorite);
}

export async function cloneGarment(id: string): Promise<Garment | null> {
  const existing = await getDB().garments.get(id);
  if (!existing || existing.deletedAt) return null;
  const now = new Date().toISOString();
  const clone: Garment = {
    ...existing,
    id: uuid(),
    shareableId: uuid(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
    syncStatus: 'pending',
    name: existing.name ? `${existing.name} (copia)` : 'Prenda (copia)',
  };
  return persistAndEnqueue('garment', clone, 'upsert');
}

export async function deleteGarment(id: string): Promise<boolean> {
  const db = getDB();
  const existing = await db.garments.get(id);
  if (!existing || existing.deletedAt) return false;
  const { version, updatedAt } = nextWrite(existing);
  const tombstone: Garment = {
    ...existing,
    version,
    updatedAt,
    deletedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
  await persistAndEnqueue('garment', tombstone, 'delete');
  return true;
}

function toGarmentInput(g: Garment): GarmentInput {
  return {
    name: g.name,
    category: g.category,
    colors: g.colors,
    brand: g.brand,
    size: g.size,
    notes: g.notes,
    washingInstructions: g.washingInstructions,
    dateAcquired: g.dateAcquired,
    archived: g.archived,
    favorite: g.favorite,
    photoId: g.photoId,
  };
}

/** Aplica una entidad remota (pull) si gana el conflicto. */
export async function applyRemoteGarment(remote: Garment): Promise<boolean> {
  const db = getDB();
  const local = await db.garments.get(remote.id);
  if (!shouldApplyRemote(local, remote)) return false;
  await db.garments.put({ ...remote, syncStatus: 'synced' });
  return true;
}

/** Marca como sincronizada solo si la versión local no avanzó desde el push. */
export async function markEntitySynced(
  entityType: OutboxEntityType,
  entityId: string,
  version: number,
): Promise<void> {
  const entity = await getEntity(entityType, entityId);
  if (!entity || entity.version !== version) return;
  await putEntity(entityType, { ...entity, syncStatus: 'synced' });
}

async function getEntity(
  entityType: OutboxEntityType,
  entityId: string,
): Promise<SyncEntity | null> {
  const db = getDB();
  switch (entityType) {
    case 'garment':
      return (await db.garments.get(entityId)) ?? null;
    case 'outfit':
      return (await db.outfits.get(entityId)) ?? null;
    case 'calendarEntry':
      return (await db.calendarEntries.get(entityId)) ?? null;
    case 'wardrobeShare':
      return (await db.wardrobeShares.get(entityId)) ?? null;
  }
}

async function putEntity(entityType: OutboxEntityType, entity: SyncEntity): Promise<void> {
  const db = getDB();
  switch (entityType) {
    case 'garment':
      await db.garments.put(entity as Garment);
      break;
    case 'outfit':
      await db.outfits.put(entity as Outfit);
      break;
    case 'calendarEntry':
      await db.calendarEntries.put(entity as CalendarEntry);
      break;
    case 'wardrobeShare':
      await db.wardrobeShares.put(entity as WardrobeShare);
      break;
  }
}

// ---------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------

export async function createOutfit(userId: string, input: OutfitInputDraft): Promise<Outfit> {
  const data = outfitInputSchema.parse(input);
  const outfit: Outfit = {
    ...baseEntity(),
    userId,
    shareableId: uuid(),
    name: data.name,
    notes: data.notes,
    slots: data.slots,
  };
  return persistAndEnqueue('outfit', outfit, 'upsert');
}

export async function updateOutfit(id: string, patch: Partial<OutfitInputDraft>): Promise<Outfit | null> {
  const db = getDB();
  const existing = await db.outfits.get(id);
  if (!existing || existing.deletedAt) return null;
  const merged = outfitInputSchema.parse({
    name: existing.name,
    notes: existing.notes,
    slots: existing.slots,
    ...patch,
  });
  const { version, updatedAt } = nextWrite(existing);
  const updated: Outfit = {
    ...existing,
    ...merged,
    version,
    updatedAt,
    syncStatus: 'pending',
  };
  return persistAndEnqueue('outfit', updated, 'upsert');
}

export async function deleteOutfit(id: string): Promise<boolean> {
  const db = getDB();
  const existing = await db.outfits.get(id);
  if (!existing || existing.deletedAt) return false;
  const { version, updatedAt } = nextWrite(existing);
  const tombstone: Outfit = {
    ...existing,
    version,
    updatedAt,
    deletedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
  await persistAndEnqueue('outfit', tombstone, 'delete');
  // Las entradas de calendario que referencian el outfit quedan huérfanas:
  // la UI las omite; la limpieza definitiva ocurre al purgar tombstones.
  return true;
}

export async function applyRemoteOutfit(remote: Outfit): Promise<boolean> {
  const db = getDB();
  const local = await db.outfits.get(remote.id);
  if (!shouldApplyRemote(local, remote)) return false;
  await db.outfits.put({ ...remote, syncStatus: 'synced' });
  return true;
}

// ---------------------------------------------------------------------------
// Calendar entries
// ---------------------------------------------------------------------------

export async function createCalendarEntry(
  userId: string,
  input: CalendarEntryInputDraft,
): Promise<CalendarEntry> {
  const data = calendarEntryInputSchema.parse(input);
  const entry: CalendarEntry = {
    ...baseEntity(),
    userId,
    date: data.date,
    outfitId: data.outfitId,
    wornAt: data.wornAt,
    notes: data.notes,
  };
  return persistAndEnqueue('calendarEntry', entry, 'upsert');
}

export async function updateCalendarEntry(
  id: string,
  patch: Partial<CalendarEntryInputDraft>,
): Promise<CalendarEntry | null> {
  const db = getDB();
  const existing = await db.calendarEntries.get(id);
  if (!existing || existing.deletedAt) return null;
  const merged = calendarEntryInputSchema.parse({
    date: existing.date,
    outfitId: existing.outfitId,
    notes: existing.notes,
    wornAt: existing.wornAt,
    ...patch,
  });
  const { version, updatedAt } = nextWrite(existing);
  const updated: CalendarEntry = {
    ...existing,
    ...merged,
    version,
    updatedAt,
    syncStatus: 'pending',
  };
  return persistAndEnqueue('calendarEntry', updated, 'upsert');
}

export async function deleteCalendarEntry(id: string): Promise<boolean> {
  const db = getDB();
  const existing = await db.calendarEntries.get(id);
  if (!existing || existing.deletedAt) return false;
  const { version, updatedAt } = nextWrite(existing);
  const tombstone: CalendarEntry = {
    ...existing,
    version,
    updatedAt,
    deletedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
  await persistAndEnqueue('calendarEntry', tombstone, 'delete');
  return true;
}

export async function applyRemoteCalendarEntry(remote: CalendarEntry): Promise<boolean> {
  const db = getDB();
  const local = await db.calendarEntries.get(remote.id);
  if (!shouldApplyRemote(local, remote)) return false;
  await db.calendarEntries.put({ ...remote, syncStatus: 'synced' });
  return true;
}

// ---------------------------------------------------------------------------
// Wardrobe shares
// ---------------------------------------------------------------------------

export async function createWardrobeShare(
  userId: string,
  granteeEmail: string | null,
  permission: Permission,
): Promise<WardrobeShare> {
  const data = permissionSchema.parse(permission);
  const share: WardrobeShare = {
    ...baseEntity(),
    grantorId: userId,
    granteeId: null,
    granteeEmail,
    permission: data,
    inviteToken: inviteToken(),
    acceptedAt: null,
  };
  return persistAndEnqueue('wardrobeShare', share, 'upsert');
}

export async function updateWardrobeShare(
  id: string,
  patch: Partial<Pick<WardrobeShare, 'permission' | 'granteeId' | 'granteeEmail' | 'acceptedAt'>>,
): Promise<WardrobeShare | null> {
  const db = getDB();
  const existing = await db.wardrobeShares.get(id);
  if (!existing || existing.deletedAt) return null;
  const { version, updatedAt } = nextWrite(existing);
  const updated: WardrobeShare = {
    ...existing,
    ...patch,
    version,
    updatedAt,
    syncStatus: 'pending',
  };
  return persistAndEnqueue('wardrobeShare', updated, 'upsert');
}

export async function deleteWardrobeShare(id: string): Promise<boolean> {
  const db = getDB();
  const existing = await db.wardrobeShares.get(id);
  if (!existing || existing.deletedAt) return false;
  const { version, updatedAt } = nextWrite(existing);
  const tombstone: WardrobeShare = {
    ...existing,
    version,
    updatedAt,
    deletedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
  await persistAndEnqueue('wardrobeShare', tombstone, 'delete');
  return true;
}

export async function applyRemoteWardrobeShare(remote: WardrobeShare): Promise<boolean> {
  const db = getDB();
  const local = await db.wardrobeShares.get(remote.id);
  if (!shouldApplyRemote(local, remote)) return false;
  await db.wardrobeShares.put({ ...remote, syncStatus: 'synced' });
  return true;
}
