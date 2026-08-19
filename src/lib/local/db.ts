/**
 * Base de datos local del navegador (IndexedDB vía Dexie).
 * Fuente primaria de la UI — offline-first.
 */
import Dexie, { type Table } from 'dexie';
import type {
  CalendarEntry,
  Garment,
  ImageRecord,
  OutboxOperation,
  Outfit,
  SyncStats,
  WardrobeShare,
} from '@/lib/domain/types';

export class MyClosetDB extends Dexie {
  garments!: Table<Garment, string>;
  outfits!: Table<Outfit, string>;
  calendarEntries!: Table<CalendarEntry, string>;
  wardrobeShares!: Table<WardrobeShare, string>;
  images!: Table<ImageRecord, string>;
  outbox!: Table<OutboxOperation, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('my-closet');
    this.version(1).stores({
      // Índices: userId para particionar por usuario, syncStatus para sync,
      // category/archived para filtros del armario, date para calendario.
      garments: 'id, userId, syncStatus, category, archived, updatedAt, [userId+archived]',
      outfits: 'id, userId, syncStatus, updatedAt',
      calendarEntries: 'id, userId, syncStatus, date, outfitId, [userId+date]',
      wardrobeShares: 'id, grantorId, inviteToken, syncStatus',
      images: 'id, userId, syncStatus',
      outbox: 'operationId, entityType, entityId, status, createdAt',
      kv: 'key',
    });
    this.version(2)
      .stores({
        garments: 'id, userId, syncStatus, category, archived, updatedAt, [userId+archived]',
        outfits: 'id, userId, syncStatus, updatedAt',
        calendarEntries: 'id, userId, syncStatus, date, outfitId, [userId+date]',
        wardrobeShares: 'id, grantorId, inviteToken, syncStatus',
        images: 'id, userId, syncStatus',
        outbox: 'operationId, userId, entityType, entityId, status, createdAt, [userId+status]',
        kv: 'key',
      })
      .upgrade(async (transaction) => {
        type LegacyOperation = Omit<OutboxOperation, 'userId'> & { userId?: string };
        await transaction
          .table<LegacyOperation, string>('outbox')
          .toCollection()
          .modify((operation) => {
            const payload = operation.payload;
            if (typeof payload !== 'object' || payload === null) return;
            const owner = 'userId' in payload
              ? payload.userId
              : 'grantorId' in payload
                ? payload.grantorId
                : null;
            if (typeof owner === 'string') operation.userId = owner;
          });
      });
  }
}

let dbInstance: MyClosetDB | null = null;

/** Singleton perezoso — evita abrir IndexedDB en el servidor. */
export function getDB(): MyClosetDB {
  if (!dbInstance) {
    dbInstance = new MyClosetDB();
  }
  return dbInstance;
}

/** Cierra la conexión (tests, cambio de cuenta). */
export async function closeDB(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

const SYNC_STATE_KEY = 'sync-state';

export async function readSyncStats(): Promise<SyncStats> {
  const db = getDB();
  const [pending, syncing, failed, stored] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').equals('syncing').count(),
    db.outbox.where('status').equals('failed').count(),
    db.kv.get(SYNC_STATE_KEY),
  ]);
  const state = stored?.value as { lastSyncedAt?: string } | undefined;
  return {
    pending,
    syncing,
    failed,
    lastSyncedAt: state?.lastSyncedAt ?? null,
  };
}

export async function writeLastSyncedAt(iso: string): Promise<void> {
  const db = getDB();
  const stored = await db.kv.get(SYNC_STATE_KEY);
  await db.kv.put({
    key: SYNC_STATE_KEY,
    value: { ...(stored?.value as object | undefined), lastSyncedAt: iso },
  });
}
