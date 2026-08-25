/**
 * Repositorio de sincronización compartido por SQLite y PostgreSQL.
 */
import { and, asc, eq, gt, gte, inArray, lte, or } from 'drizzle-orm';
import { resolveConflict } from '@/lib/domain/conflict';
import {
  syncPullCursorPayloadSchema,
  type SyncPullCursorPayload,
} from '@/lib/domain/validation';
import type {
  CalendarEntry,
  Garment,
  ImageRecord,
  Outfit,
  WardrobeShare,
} from '@/lib/domain/types';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';

export type UpsertOutcome<T> =
  | { status: 'applied'; entity: T }
  | { status: 'conflict'; remote: T };

// --- Mapeo fila ↔ entidad --------------------------------------------------

type GarmentRow =
  | typeof sqliteSchema.garments.$inferSelect
  | typeof pgSchema.garments.$inferSelect;
type OutfitRow =
  | typeof sqliteSchema.outfits.$inferSelect
  | typeof pgSchema.outfits.$inferSelect;
type CalendarRow =
  | typeof sqliteSchema.calendarEntries.$inferSelect
  | typeof pgSchema.calendarEntries.$inferSelect;
type ShareRow =
  | typeof sqliteSchema.wardrobeShares.$inferSelect
  | typeof pgSchema.wardrobeShares.$inferSelect;
type ImageRow =
  | typeof sqliteSchema.images.$inferSelect
  | typeof pgSchema.images.$inferSelect;

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
    favorite: row.favorite,
    photoId: row.photoId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    deletedAt: row.deletedAt,
    syncStatus: 'synced',
  };
}

function fromImageRow(row: ImageRow): Omit<ImageRecord, 'blob' | 'syncStatus'> {
  return {
    id: row.id,
    userId: row.userId,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    remoteUrl: row.remoteUrl ?? `/api/images/${row.id}`,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const existingRow = await db.postgres
      .select()
      .from(pgSchema.garments)
      .where(eq(pgSchema.garments.id, garment.id))
      .limit(1);
    const existing = existingRow[0] ? fromGarmentRow(existingRow[0]) : undefined;
    if (existing && existing.userId !== userId) throw new OwnershipError();
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
      favorite: garment.favorite,
      photoId: garment.photoId,
      createdAt: garment.createdAt,
      updatedAt: garment.updatedAt,
      serverUpdatedAt: new Date(),
      version: garment.version,
      deletedAt: garment.deletedAt,
    };
    return upsertGeneric(existing, garment, async () => {
      await db.postgres
        .insert(pgSchema.garments)
        .values(values)
        .onConflictDoUpdate({ target: pgSchema.garments.id, set: values });
    });
  }
  const sqlite = db.sqlite;
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
    favorite: garment.favorite,
    photoId: garment.photoId,
    createdAt: garment.createdAt,
    updatedAt: garment.updatedAt,
    serverUpdatedAt: new Date().toISOString(),
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const existingRow = await db.postgres
      .select()
      .from(pgSchema.outfits)
      .where(eq(pgSchema.outfits.id, outfit.id))
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
      serverUpdatedAt: new Date(),
      version: outfit.version,
      deletedAt: outfit.deletedAt,
    };
    return upsertGeneric(existing, outfit, async () => {
      await db.postgres
        .insert(pgSchema.outfits)
        .values(values)
        .onConflictDoUpdate({ target: pgSchema.outfits.id, set: values });
    });
  }
  const sqlite = db.sqlite;
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
    serverUpdatedAt: new Date().toISOString(),
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const existingRow = await db.postgres
      .select()
      .from(pgSchema.calendarEntries)
      .where(eq(pgSchema.calendarEntries.id, entry.id))
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
      serverUpdatedAt: new Date(),
      version: entry.version,
      deletedAt: entry.deletedAt,
    };
    return upsertGeneric(existing, entry, async () => {
      await db.postgres
        .insert(pgSchema.calendarEntries)
        .values(values)
        .onConflictDoUpdate({ target: pgSchema.calendarEntries.id, set: values });
    });
  }
  const sqlite = db.sqlite;
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
    serverUpdatedAt: new Date().toISOString(),
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const existingRow = await db.postgres
      .select()
      .from(pgSchema.wardrobeShares)
      .where(eq(pgSchema.wardrobeShares.id, share.id))
      .limit(1);
    const existing = existingRow[0] ? fromShareRow(existingRow[0]) : undefined;
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
      serverUpdatedAt: new Date(),
      version: share.version,
      deletedAt: share.deletedAt,
    };
    return upsertGeneric(existing, share, async () => {
      await db.postgres
        .insert(pgSchema.wardrobeShares)
        .values(values)
        .onConflictDoUpdate({ target: pgSchema.wardrobeShares.id, set: values });
    });
  }
  const sqlite = db.sqlite;
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
    serverUpdatedAt: new Date().toISOString(),
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
  hasMore: boolean;
  nextCursor: string | null;
  images: Omit<ImageRecord, 'blob' | 'syncStatus'>[];
  garments: Garment[];
  outfits: Outfit[];
  calendarEntries: CalendarEntry[];
  wardrobeShares: WardrobeShare[];
}

export class InvalidPullCursorError extends Error {
  constructor() {
    super('El cursor de sincronización no es válido');
    this.name = 'InvalidPullCursorError';
  }
}

type PullEntityName = keyof SyncPullCursorPayload['entities'];
type PullPosition = SyncPullCursorPayload['entities'][PullEntityName]['position'];

function initialPullCursor(since: string | null): SyncPullCursorPayload {
  const initialEntity = () => ({ done: false, position: null });
  return {
    since,
    upperBound: new Date().toISOString(),
    entities: {
      images: initialEntity(),
      garments: initialEntity(),
      outfits: initialEntity(),
      calendarEntries: initialEntity(),
      wardrobeShares: initialEntity(),
    },
  };
}

function decodePullCursor(cursor: string): SyncPullCursorPayload {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return syncPullCursorPayloadSchema.parse(decoded);
  } catch {
    throw new InvalidPullCursorError();
  }
}

function encodePullCursor(cursor: SyncPullCursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function pageRows<T extends { id: string }>(
  rows: T[],
  limit: number,
  timestamp: (row: T) => string,
): { rows: T[]; done: boolean; position: PullPosition } {
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    rows: selected,
    done: rows.length <= limit,
    position: last ? { at: timestamp(last), id: last.id } : null,
  };
}

export async function pullAll(
  userId: string,
  since: string | null,
  options: { cursor?: string; limit?: number } = {},
): Promise<PullResult> {
  const db = await getServerDB();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const state = options.cursor ? decodePullCursor(options.cursor) : initialPullCursor(since);
  const cutoff = state.since ?? new Date(0).toISOString();
  const upperBound = state.upperBound;

  if (db.dialect === 'postgres') {
    const after = (position: PullPosition) => position?.at ?? cutoff;
    const imagePosition = state.entities.images.position;
    const garmentPosition = state.entities.garments.position;
    const outfitPosition = state.entities.outfits.position;
    const calendarPosition = state.entities.calendarEntries.position;
    const sharePosition = state.entities.wardrobeShares.position;
    const [imageRows, garmentRows, outfitRows, calendarRows, shareRows] = await Promise.all([
      state.entities.images.done ? Promise.resolve([]) : db.postgres
        .select()
        .from(pgSchema.images)
        .where(
          and(
            eq(pgSchema.images.userId, userId),
            lte(pgSchema.images.updatedAt, new Date(upperBound)),
            or(
              imagePosition
                ? gt(pgSchema.images.updatedAt, new Date(after(imagePosition)))
                : gte(pgSchema.images.updatedAt, new Date(cutoff)),
              imagePosition
                ? and(
                    eq(pgSchema.images.updatedAt, new Date(imagePosition.at)),
                    gt(pgSchema.images.id, imagePosition.id),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(asc(pgSchema.images.updatedAt), asc(pgSchema.images.id))
        .limit(limit + 1),
      state.entities.garments.done ? Promise.resolve([]) : db.postgres
        .select()
        .from(pgSchema.garments)
        .where(and(
          eq(pgSchema.garments.userId, userId),
          lte(pgSchema.garments.serverUpdatedAt, new Date(upperBound)),
          or(
            garmentPosition
              ? gt(pgSchema.garments.serverUpdatedAt, new Date(after(garmentPosition)))
              : gte(pgSchema.garments.serverUpdatedAt, new Date(cutoff)),
            garmentPosition
              ? and(
                  eq(pgSchema.garments.serverUpdatedAt, new Date(garmentPosition.at)),
                  gt(pgSchema.garments.id, garmentPosition.id),
                )
              : undefined,
          ),
        ))
        .orderBy(asc(pgSchema.garments.serverUpdatedAt), asc(pgSchema.garments.id))
        .limit(limit + 1),
      state.entities.outfits.done ? Promise.resolve([]) : db.postgres
        .select()
        .from(pgSchema.outfits)
        .where(and(
          eq(pgSchema.outfits.userId, userId),
          lte(pgSchema.outfits.serverUpdatedAt, new Date(upperBound)),
          or(
            outfitPosition
              ? gt(pgSchema.outfits.serverUpdatedAt, new Date(after(outfitPosition)))
              : gte(pgSchema.outfits.serverUpdatedAt, new Date(cutoff)),
            outfitPosition
              ? and(
                  eq(pgSchema.outfits.serverUpdatedAt, new Date(outfitPosition.at)),
                  gt(pgSchema.outfits.id, outfitPosition.id),
                )
              : undefined,
          ),
        ))
        .orderBy(asc(pgSchema.outfits.serverUpdatedAt), asc(pgSchema.outfits.id))
        .limit(limit + 1),
      state.entities.calendarEntries.done ? Promise.resolve([]) : db.postgres
        .select()
        .from(pgSchema.calendarEntries)
        .where(
          and(
            eq(pgSchema.calendarEntries.userId, userId),
            lte(pgSchema.calendarEntries.serverUpdatedAt, new Date(upperBound)),
            or(
              calendarPosition
                ? gt(pgSchema.calendarEntries.serverUpdatedAt, new Date(after(calendarPosition)))
                : gte(pgSchema.calendarEntries.serverUpdatedAt, new Date(cutoff)),
              calendarPosition
                ? and(
                    eq(pgSchema.calendarEntries.serverUpdatedAt, new Date(calendarPosition.at)),
                    gt(pgSchema.calendarEntries.id, calendarPosition.id),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(asc(pgSchema.calendarEntries.serverUpdatedAt), asc(pgSchema.calendarEntries.id))
        .limit(limit + 1),
      state.entities.wardrobeShares.done ? Promise.resolve([]) : db.postgres
        .select()
        .from(pgSchema.wardrobeShares)
        .where(
          and(
            eq(pgSchema.wardrobeShares.grantorId, userId),
            lte(pgSchema.wardrobeShares.serverUpdatedAt, new Date(upperBound)),
            or(
              sharePosition
                ? gt(pgSchema.wardrobeShares.serverUpdatedAt, new Date(after(sharePosition)))
                : gte(pgSchema.wardrobeShares.serverUpdatedAt, new Date(cutoff)),
              sharePosition
                ? and(
                    eq(pgSchema.wardrobeShares.serverUpdatedAt, new Date(sharePosition.at)),
                    gt(pgSchema.wardrobeShares.id, sharePosition.id),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(asc(pgSchema.wardrobeShares.serverUpdatedAt), asc(pgSchema.wardrobeShares.id))
        .limit(limit + 1),
    ]);
    const pages = {
      images: pageRows(imageRows, limit, (row) => row.updatedAt.toISOString()),
      garments: pageRows(garmentRows, limit, (row) => row.serverUpdatedAt.toISOString()),
      outfits: pageRows(outfitRows, limit, (row) => row.serverUpdatedAt.toISOString()),
      calendarEntries: pageRows(calendarRows, limit, (row) => row.serverUpdatedAt.toISOString()),
      wardrobeShares: pageRows(shareRows, limit, (row) => row.serverUpdatedAt.toISOString()),
    };
    const nextState: SyncPullCursorPayload = {
      ...state,
      entities: {
        images: state.entities.images.done ? state.entities.images : { done: pages.images.done, position: pages.images.position },
        garments: state.entities.garments.done ? state.entities.garments : { done: pages.garments.done, position: pages.garments.position },
        outfits: state.entities.outfits.done ? state.entities.outfits : { done: pages.outfits.done, position: pages.outfits.position },
        calendarEntries: state.entities.calendarEntries.done ? state.entities.calendarEntries : { done: pages.calendarEntries.done, position: pages.calendarEntries.position },
        wardrobeShares: state.entities.wardrobeShares.done ? state.entities.wardrobeShares : { done: pages.wardrobeShares.done, position: pages.wardrobeShares.position },
      },
    };
    const hasMore = Object.values(nextState.entities).some((entity) => !entity.done);
    return {
      serverTime: upperBound,
      hasMore,
      nextCursor: hasMore ? encodePullCursor(nextState) : null,
      images: pages.images.rows.map(fromImageRow),
      garments: pages.garments.rows.map(fromGarmentRow),
      outfits: pages.outfits.rows.map(fromOutfitRow),
      calendarEntries: pages.calendarEntries.rows.map(fromCalendarRow),
      wardrobeShares: pages.wardrobeShares.rows.map(fromShareRow),
    };
  }
  const sqlite = db.sqlite;
  const after = (position: PullPosition) => position?.at ?? cutoff;
  const imagePosition = state.entities.images.position;
  const garmentPosition = state.entities.garments.position;
  const outfitPosition = state.entities.outfits.position;
  const calendarPosition = state.entities.calendarEntries.position;
  const sharePosition = state.entities.wardrobeShares.position;
  const [imageRows, garmentRows, outfitRows, calendarRows, shareRows] = await Promise.all([
    state.entities.images.done ? Promise.resolve([]) : sqlite
      .select()
      .from(sqliteSchema.images)
      .where(and(
        eq(sqliteSchema.images.userId, userId),
        lte(sqliteSchema.images.updatedAt, upperBound),
        or(
          imagePosition
            ? gt(sqliteSchema.images.updatedAt, after(imagePosition))
            : gte(sqliteSchema.images.updatedAt, cutoff),
          imagePosition
            ? and(eq(sqliteSchema.images.updatedAt, imagePosition.at), gt(sqliteSchema.images.id, imagePosition.id))
            : undefined,
        ),
      ))
      .orderBy(asc(sqliteSchema.images.updatedAt), asc(sqliteSchema.images.id))
      .limit(limit + 1),
    state.entities.garments.done ? Promise.resolve([]) : sqlite
      .select()
      .from(sqliteSchema.garments)
      .where(and(
        eq(sqliteSchema.garments.userId, userId),
        lte(sqliteSchema.garments.serverUpdatedAt, upperBound),
        or(
          garmentPosition
            ? gt(sqliteSchema.garments.serverUpdatedAt, after(garmentPosition))
            : gte(sqliteSchema.garments.serverUpdatedAt, cutoff),
          garmentPosition
            ? and(eq(sqliteSchema.garments.serverUpdatedAt, garmentPosition.at), gt(sqliteSchema.garments.id, garmentPosition.id))
            : undefined,
        ),
      ))
      .orderBy(asc(sqliteSchema.garments.serverUpdatedAt), asc(sqliteSchema.garments.id))
      .limit(limit + 1),
    state.entities.outfits.done ? Promise.resolve([]) : sqlite
      .select()
      .from(sqliteSchema.outfits)
      .where(and(
        eq(sqliteSchema.outfits.userId, userId),
        lte(sqliteSchema.outfits.serverUpdatedAt, upperBound),
        or(
          outfitPosition
            ? gt(sqliteSchema.outfits.serverUpdatedAt, after(outfitPosition))
            : gte(sqliteSchema.outfits.serverUpdatedAt, cutoff),
          outfitPosition
            ? and(eq(sqliteSchema.outfits.serverUpdatedAt, outfitPosition.at), gt(sqliteSchema.outfits.id, outfitPosition.id))
            : undefined,
        ),
      ))
      .orderBy(asc(sqliteSchema.outfits.serverUpdatedAt), asc(sqliteSchema.outfits.id))
      .limit(limit + 1),
    state.entities.calendarEntries.done ? Promise.resolve([]) : sqlite
      .select()
      .from(sqliteSchema.calendarEntries)
      .where(
        and(
          eq(sqliteSchema.calendarEntries.userId, userId),
          lte(sqliteSchema.calendarEntries.serverUpdatedAt, upperBound),
          or(
            calendarPosition
              ? gt(sqliteSchema.calendarEntries.serverUpdatedAt, after(calendarPosition))
              : gte(sqliteSchema.calendarEntries.serverUpdatedAt, cutoff),
            calendarPosition
              ? and(eq(sqliteSchema.calendarEntries.serverUpdatedAt, calendarPosition.at), gt(sqliteSchema.calendarEntries.id, calendarPosition.id))
              : undefined,
          ),
        ),
      )
      .orderBy(asc(sqliteSchema.calendarEntries.serverUpdatedAt), asc(sqliteSchema.calendarEntries.id))
      .limit(limit + 1),
    state.entities.wardrobeShares.done ? Promise.resolve([]) : sqlite
      .select()
      .from(sqliteSchema.wardrobeShares)
      .where(
        and(
          eq(sqliteSchema.wardrobeShares.grantorId, userId),
          lte(sqliteSchema.wardrobeShares.serverUpdatedAt, upperBound),
          or(
            sharePosition
              ? gt(sqliteSchema.wardrobeShares.serverUpdatedAt, after(sharePosition))
              : gte(sqliteSchema.wardrobeShares.serverUpdatedAt, cutoff),
            sharePosition
              ? and(eq(sqliteSchema.wardrobeShares.serverUpdatedAt, sharePosition.at), gt(sqliteSchema.wardrobeShares.id, sharePosition.id))
              : undefined,
          ),
        ),
      )
      .orderBy(asc(sqliteSchema.wardrobeShares.serverUpdatedAt), asc(sqliteSchema.wardrobeShares.id))
      .limit(limit + 1),
  ]);
  const pages = {
    images: pageRows(imageRows, limit, (row) => row.updatedAt),
    garments: pageRows(garmentRows, limit, (row) => row.serverUpdatedAt),
    outfits: pageRows(outfitRows, limit, (row) => row.serverUpdatedAt),
    calendarEntries: pageRows(calendarRows, limit, (row) => row.serverUpdatedAt),
    wardrobeShares: pageRows(shareRows, limit, (row) => row.serverUpdatedAt),
  };
  const nextState: SyncPullCursorPayload = {
    ...state,
    entities: {
      images: state.entities.images.done ? state.entities.images : { done: pages.images.done, position: pages.images.position },
      garments: state.entities.garments.done ? state.entities.garments : { done: pages.garments.done, position: pages.garments.position },
      outfits: state.entities.outfits.done ? state.entities.outfits : { done: pages.outfits.done, position: pages.outfits.position },
      calendarEntries: state.entities.calendarEntries.done ? state.entities.calendarEntries : { done: pages.calendarEntries.done, position: pages.calendarEntries.position },
      wardrobeShares: state.entities.wardrobeShares.done ? state.entities.wardrobeShares : { done: pages.wardrobeShares.done, position: pages.wardrobeShares.position },
    },
  };
  const hasMore = Object.values(nextState.entities).some((entity) => !entity.done);
  return {
    serverTime: upperBound,
    hasMore,
    nextCursor: hasMore ? encodePullCursor(nextState) : null,
    images: pages.images.rows.map(fromImageRow),
    garments: pages.garments.rows.map(fromGarmentRow),
    outfits: pages.outfits.rows.map(fromOutfitRow),
    calendarEntries: pages.calendarEntries.rows.map(fromCalendarRow),
    wardrobeShares: pages.wardrobeShares.rows.map(fromShareRow),
  };
}

// --- Lecturas públicas (shareableId) ----------------------------------------

export async function getPublicGarment(shareableId: string): Promise<Garment | null> {
  const db = await getServerDB();
  const rows = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.garments)
        .where(eq(pgSchema.garments.shareableId, shareableId))
        .limit(1)
    : await db.sqlite
        .select()
        .from(sqliteSchema.garments)
        .where(eq(sqliteSchema.garments.shareableId, shareableId))
        .limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) return null;
  return fromGarmentRow(row);
}

export async function getPublicOutfit(shareableId: string): Promise<Outfit | null> {
  const db = await getServerDB();
  const rows = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.outfits)
        .where(eq(pgSchema.outfits.shareableId, shareableId))
        .limit(1)
    : await db.sqlite
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
  const ids = outfit.slots.map((s) => s.garmentId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const db = await getServerDB();
  const rows = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.garments)
        .where(inArray(pgSchema.garments.id, ids))
    : await db.sqlite
        .select()
        .from(sqliteSchema.garments)
        .where(inArray(sqliteSchema.garments.id, ids));
  return rows.filter((row) => !row.deletedAt).map(fromGarmentRow);
}
