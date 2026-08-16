/**
 * Repositorio de sincronización (implementación SQLite para desarrollo;
 * la variante PostgreSQL espeja este contrato — ver docs/ARCHITECTURE.md).
 */
import { and, eq, gt } from 'drizzle-orm';
import { resolveConflict } from '@/lib/domain/conflict';
import type {
  CalendarEntry,
  Garment,
  Outfit,
  WardrobeShare,
} from '@/lib/domain/types';
import { getSqlite, sqliteSchema } from '@/server/db';

export type UpsertOutcome<T> =
  | { status: 'applied'; entity: T }
  | { status: 'conflict'; remote: T };

// --- Mapeo fila ↔ entidad --------------------------------------------------

type GarmentRow = typeof sqliteSchema.garments.$inferSelect;
type OutfitRow = typeof sqliteSchema.outfits.$inferSelect;
type CalendarRow = typeof sqliteSchema.calendarEntries.$inferSelect;
type ShareRow = typeof sqliteSchema.wardrobeShares.$inferSelect;

function fromGarmentRow(row: GarmentRow): Garment {
  return {
    id: row.id,
    userId: row.userId,
    shareableId: row.shareableId,
    name: row.name,
    category: row.category,
    colors: JSON.parse(row.colors) as string[],
    brand: row.brand,
    size: row.size,
    notes: row.notes,
    washingInstructions: row.washingInstructions,
    dateAcquired: row.dateAcquired,
    archived: row.archived,
    photoId: row.photoId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    deletedAt: row.deletedAt,
    syncStatus: 'synced',
  };
}

function fromOutfitRow(row: OutfitRow): Outfit {
  return {
    id: row.id,
    userId: row.userId,
    shareableId: row.shareableId,
    name: row.name,
    notes: row.notes,
    slots: JSON.parse(row.slots) as Outfit['slots'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    deletedAt: row.deletedAt,
    syncStatus: 'synced',
  };
}

function fromCalendarRow(row: CalendarRow): CalendarEntry {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    outfitId: row.outfitId,
    wornAt: row.wornAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    deletedAt: row.deletedAt,
    syncStatus: 'synced',
  };
}

function fromShareRow(row: ShareRow): WardrobeShare {
  return {
    id: row.id,
    grantorId: row.grantorId,
    granteeId: row.granteeId,
    granteeEmail: row.granteeEmail,
    permission: row.permission,
    inviteToken: row.inviteToken,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    deletedAt: row.deletedAt,
    syncStatus: 'synced',
  };
}

// --- Upserts con detección de conflictos ------------------------------------

async function upsertGeneric<T extends { id: string; version: number; updatedAt: string; deletedAt: string | null }>(
  existing: T | undefined,
  incoming: T,
  write: () => Promise<void>,
): Promise<UpsertOutcome<T>> {
  if (existing && resolveConflict(existing, incoming) === 'local') {
    return { status: 'conflict', remote: existing };
  }
  await write();
  return { status: 'applied', entity: incoming };
}

export async function upsertGarment(
  userId: string,
  garment: Garment,
): Promise<UpsertOutcome<Garment>> {
  const sqlite = await getSqlite();
  const existingRow = await sqlite
    .select()
    .from(sqliteSchema.garments)
    .where(eq(sqliteSchema.garments.id, garment.id))
    .limit(1);
  const existing = existingRow[0] ? fromGarmentRow(existingRow[0]) : undefined;
  // Protección IDOR: la entidad pertenece a otro usuario.
  if (existing && existing.userId !== userId) {
    throw new OwnershipError();
  }
  const values = {
    id: garment.id,
    userId,
    shareableId: garment.shareableId,
    name: garment.name,
    category: garment.category,
    colors: JSON.stringify(garment.colors),
    brand: garment.brand,
    size: garment.size,
    notes: garment.notes,
    washingInstructions: garment.washingInstructions,
    dateAcquired: garment.dateAcquired,
    archived: garment.archived,
    photoId: garment.photoId,
    createdAt: garment.createdAt,
    updatedAt: garment.updatedAt,
    version: garment.version,
    deletedAt: garment.deletedAt,
  };
  return upsertGeneric(existing, garment, async () => {
    await sqlite
      .insert(sqliteSchema.garments)
      .values(values)
      .onConflictDoUpdate({ target: sqliteSchema.garments.id, set: values });
  });
}

export async function upsertOutfit(
  userId: string,
  outfit: Outfit,
): Promise<UpsertOutcome<Outfit>> {
  const sqlite = await getSqlite();
  const existingRow = await sqlite
    .select()
    .from(sqliteSchema.outfits)
    .where(eq(sqliteSchema.outfits.id, outfit.id))
    .limit(1);
  const existing = existingRow[0] ? fromOutfitRow(existingRow[0]) : undefined;
  if (existing && existing.userId !== userId) throw new OwnershipError();
  const values = {
    id: outfit.id,
    userId,
    shareableId: outfit.shareableId,
    name: outfit.name,
    notes: outfit.notes,
    slots: JSON.stringify(outfit.slots),
    createdAt: outfit.createdAt,
    updatedAt: outfit.updatedAt,
    version: outfit.version,
    deletedAt: outfit.deletedAt,
  };
  return upsertGeneric(existing, outfit, async () => {
    await sqlite
      .insert(sqliteSchema.outfits)
      .values(values)
      .onConflictDoUpdate({ target: sqliteSchema.outfits.id, set: values });
  });
}

export async function upsertCalendarEntry(
  userId: string,
  entry: CalendarEntry,
): Promise<UpsertOutcome<CalendarEntry>> {
  const sqlite = await getSqlite();
  const existingRow = await sqlite
    .select()
    .from(sqliteSchema.calendarEntries)
    .where(eq(sqliteSchema.calendarEntries.id, entry.id))
    .limit(1);
  const existing = existingRow[0] ? fromCalendarRow(existingRow[0]) : undefined;
  if (existing && existing.userId !== userId) throw new OwnershipError();
  const values = {
    id: entry.id,
    userId,
    date: entry.date,
    outfitId: entry.outfitId,
    wornAt: entry.wornAt,
    notes: entry.notes,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    version: entry.version,
    deletedAt: entry.deletedAt,
  };
  return upsertGeneric(existing, entry, async () => {
    await sqlite
      .insert(sqliteSchema.calendarEntries)
      .values(values)
      .onConflictDoUpdate({ target: sqliteSchema.calendarEntries.id, set: values });
  });
}

export async function upsertWardrobeShare(
  userId: string,
  share: WardrobeShare,
): Promise<UpsertOutcome<WardrobeShare>> {
  const sqlite = await getSqlite();
  const existingRow = await sqlite
    .select()
    .from(sqliteSchema.wardrobeShares)
    .where(eq(sqliteSchema.wardrobeShares.id, share.id))
    .limit(1);
  const existing = existingRow[0] ? fromShareRow(existingRow[0]) : undefined;
  // Solo el grantor puede escribir su share.
  if (existing && existing.grantorId !== userId) throw new OwnershipError();
  if (share.grantorId !== userId) throw new OwnershipError();
  const values = {
    id: share.id,
    grantorId: userId,
    granteeId: share.granteeId,
    granteeEmail: share.granteeEmail,
    permission: share.permission,
    inviteToken: share.inviteToken,
    acceptedAt: share.acceptedAt,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    version: share.version,
    deletedAt: share.deletedAt,
  };
  return upsertGeneric(existing, share, async () => {
    await sqlite
      .insert(sqliteSchema.wardrobeShares)
      .values(values)
      .onConflictDoUpdate({ target: sqliteSchema.wardrobeShares.id, set: values });
  });
}

export class OwnershipError extends Error {
  constructor() {
    super('El recurso pertenece a otro usuario');
    this.name = 'OwnershipError';
  }
}

// --- Pull incremental --------------------------------------------------------

export interface PullResult {
  serverTime: string;
  garments: Garment[];
  outfits: Outfit[];
  calendarEntries: CalendarEntry[];
  wardrobeShares: WardrobeShare[];
}

export async function pullAll(
  userId: string,
  since: string | null,
): Promise<PullResult> {
  const sqlite = await getSqlite();
  const cutoff = since ?? '0000-01-01T00:00:00.000Z';

  const [garmentRows, outfitRows, calendarRows, shareRows] = await Promise.all([
    sqlite
      .select()
      .from(sqliteSchema.garments)
      .where(and(eq(sqliteSchema.garments.userId, userId), gt(sqliteSchema.garments.updatedAt, cutoff))),
    sqlite
      .select()
      .from(sqliteSchema.outfits)
      .where(and(eq(sqliteSchema.outfits.userId, userId), gt(sqliteSchema.outfits.updatedAt, cutoff))),
    sqlite
      .select()
      .from(sqliteSchema.calendarEntries)
      .where(
        and(eq(sqliteSchema.calendarEntries.userId, userId), gt(sqliteSchema.calendarEntries.updatedAt, cutoff)),
      ),
    sqlite
      .select()
      .from(sqliteSchema.wardrobeShares)
      .where(
        and(eq(sqliteSchema.wardrobeShares.grantorId, userId), gt(sqliteSchema.wardrobeShares.updatedAt, cutoff)),
      ),
  ]);

  return {
    serverTime: new Date().toISOString(),
    garments: garmentRows.map(fromGarmentRow),
    outfits: outfitRows.map(fromOutfitRow),
    calendarEntries: calendarRows.map(fromCalendarRow),
    wardrobeShares: shareRows.map(fromShareRow),
  };
}

// --- Lecturas públicas (shareableId) ----------------------------------------

export async function getPublicGarment(shareableId: string): Promise<Garment | null> {
  const sqlite = await getSqlite();
  const rows = await sqlite
    .select()
    .from(sqliteSchema.garments)
    .where(eq(sqliteSchema.garments.shareableId, shareableId))
    .limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) return null;
  return fromGarmentRow(row);
}

export async function getPublicOutfit(shareableId: string): Promise<Outfit | null> {
  const sqlite = await getSqlite();
  const rows = await sqlite
    .select()
    .from(sqliteSchema.outfits)
    .where(eq(sqliteSchema.outfits.shareableId, shareableId))
    .limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) return null;
  return fromOutfitRow(row);
}

/** Prendas de un outfit público (para renderizar el share con miniaturas). */
export async function getPublicOutfitGarments(outfit: Outfit): Promise<Garment[]> {
  const sqlite = await getSqlite();
  const ids = outfit.slots.map((s) => s.garmentId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const rows = await sqlite.select().from(sqliteSchema.garments);
  return rows
    .filter((row) => ids.includes(row.id) && !row.deletedAt)
    .map(fromGarmentRow);
}
