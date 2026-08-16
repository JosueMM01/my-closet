/**
 * Sync Engine: replica IndexedDB con el backend cuando hay conexión.
 *
 * Comportamiento:
 *  - push de la outbox por lotes;
 *  - pull incremental (since lastSyncedAt);
 *  - nunca descarta operaciones por fallos de red;
 *  - 401 → sesión expirada: se conservan datos y outbox, se pide re-login.
 */
import type {
  CalendarEntry,
  Garment,
  OutboxOperation,
  Outfit,
  WardrobeShare,
} from '@/lib/domain/types';
import { getDB, readSyncStats, writeLastSyncedAt } from './db';
import { getLocalProfile } from './kv';
import {
  claimPendingOperations,
  markOperationFailed,
  markOperationSynced,
  releaseStaleSyncing,
} from './outbox';
import {
  applyRemoteCalendarEntry,
  applyRemoteGarment,
  applyRemoteOutfit,
  applyRemoteWardrobeShare,
  markEntitySynced,
} from './repositories';

type SyncStateListener = () => void;

const listeners = new Set<SyncStateListener>();
let running = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function subscribeSyncState(listener: SyncStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export class SessionExpiredError extends Error {
  constructor() {
    super('La sesión remota expiró; los datos locales se conservan.');
    this.name = 'SessionExpiredError';
  }
}

interface PushOperationResult {
  operationId: string;
  status: 'applied' | 'conflict' | 'invalid';
  remote?: Record<string, unknown>;
}

interface PushResponse {
  results: PushOperationResult[];
}

interface PullResponse {
  serverTime: string;
  garments?: Garment[];
  outfits?: Outfit[];
  calendarEntries?: CalendarEntry[];
  wardrobeShares?: WardrobeShare[];
}

async function pushBatch(ops: OutboxOperation[]): Promise<void> {
  const response = await fetch('/api/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' },
    body: JSON.stringify({
      operations: ops.map((op) => ({
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        payload: op.payload,
        clientUpdatedAt: (op.payload as { updatedAt?: string }).updatedAt ?? op.createdAt,
        clientVersion: (op.payload as { version?: number }).version ?? 1,
      })),
    }),
  });

  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error(`push HTTP ${response.status}`);

  const data = (await response.json()) as PushResponse;
  const byId = new Map(data.results.map((r) => [r.operationId, r]));

  for (const op of ops) {
    const result = byId.get(op.operationId);
    if (!result) {
      await markOperationFailed(op.operationId, 'sin respuesta del servidor', false);
      continue;
    }
    switch (result.status) {
      case 'applied':
        await markOperationSynced(op.operationId);
        await markEntitySynced(
          op.entityType,
          op.entityId,
          (op.payload as { version?: number }).version ?? 1,
        );
        break;
      case 'conflict':
        // El servidor conservó una versión más nueva: aplicarla localmente.
        await markOperationSynced(op.operationId);
        if (result.remote) {
          await applyRemote(op.entityType, result.remote);
        }
        break;
      case 'invalid':
        // Error permanente (validación): no reintentar infinitamente.
        await markOperationFailed(op.operationId, 'rechazado por validación del servidor', true);
        break;
    }
  }
}

async function applyRemote(
  entityType: OutboxOperation['entityType'],
  remote: Record<string, unknown>,
): Promise<void> {
  switch (entityType) {
    case 'garment':
      await applyRemoteGarment(remote as unknown as Garment);
      break;
    case 'outfit':
      await applyRemoteOutfit(remote as unknown as Outfit);
      break;
    case 'calendarEntry':
      await applyRemoteCalendarEntry(remote as unknown as CalendarEntry);
      break;
    case 'wardrobeShare':
      await applyRemoteWardrobeShare(remote as unknown as WardrobeShare);
      break;
  }
}

async function pushPendingImages(): Promise<void> {
  const db = getDB();
  const pending = await db.images.where('syncStatus').anyOf(['pending', 'failed']).toArray();
  for (const image of pending) {
    if (!image.blob) continue;
    const form = new FormData();
    form.append('id', image.id);
    form.append('file', image.blob, `${image.id}.webp`);
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: { 'x-requested-with': 'my-closet' },
      body: form,
    });
    if (response.status === 401) throw new SessionExpiredError();
    if (!response.ok) {
      await db.images.put({
        ...image,
        syncStatus: 'failed',
      });
      continue;
    }
    const { remoteUrl } = (await response.json()) as { remoteUrl: string };
    await db.images.put({ ...image, remoteUrl, syncStatus: 'synced' });
  }
}

async function pull(): Promise<void> {
  const db = getDB();
  const stored = await db.kv.get('sync-state');
  const since = ((stored?.value as { lastPulledAt?: string } | undefined)?.lastPulledAt) ?? null;
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await fetch(`/api/sync/pull${query}`, {
    headers: { 'x-requested-with': 'my-closet' },
  });
  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error(`pull HTTP ${response.status}`);

  const data = (await response.json()) as PullResponse;
  for (const garment of data.garments ?? []) await applyRemoteGarment(garment);
  for (const outfit of data.outfits ?? []) await applyRemoteOutfit(outfit);
  for (const entry of data.calendarEntries ?? []) await applyRemoteCalendarEntry(entry);
  for (const share of data.wardrobeShares ?? []) await applyRemoteWardrobeShare(share);

  const state = (await db.kv.get('sync-state'))?.value as object | undefined;
  await db.kv.put({
    key: 'sync-state',
    value: { ...(state ?? {}), lastPulledAt: data.serverTime },
  });
}

/** Ejecuta un ciclo completo push+pull. Lanza si la sesión expiró. */
export async function runSync(): Promise<void> {
  if (running) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  // Sin perfil local no hay sesión que sincronizar (evita 401 espurios).
  if (!(await getLocalProfile())) return;
  running = true;
  notify();
  try {
    await releaseStaleSyncing();

    // Push por lotes hasta agotar la outbox.
    for (;;) {
      const batch = await claimPendingOperations(50);
      if (batch.length === 0) break;
      await pushBatch(batch);
    }

    await pushPendingImages();
    await pull();
    await writeLastSyncedAt(new Date().toISOString());
  } finally {
    running = false;
    notify();
  }
}

/** Sincroniza si es posible; los errores de red se ignoran silenciosamente. */
export async function maybeSync(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void runSync().catch(() => {
      /* offline o servidor no disponible: estado normal */
    });
  }, 800);
}

/**
 * Arranca los disparadores: reconnect, foreground, intervalo y carga.
 * No depende de Background Sync: siempre hay fallback al abrir/reanudar.
 */
export function startSyncEngine(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', () => void maybeSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeSync();
  });
  periodicTimer = setInterval(() => void maybeSync(), 60_000);

  // Background Sync cuando exista soporte (además del fallback anterior).
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    void navigator.serviceWorker.ready.then((registration) => {
      return (registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }).sync?.register('outbox-sync');
    }).catch(() => undefined);
  }

  void maybeSync();
}

export function stopSyncEngine(): void {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
  started = false;
}

export function isSyncRunning(): boolean {
  return running;
}

export { readSyncStats };
