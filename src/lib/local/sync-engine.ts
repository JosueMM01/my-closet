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
  ImageRecord,
  OutboxOperation,
  Outfit,
  WardrobeShare,
} from '@/lib/domain/types';
import {
  cloudinaryUploadSignatureSchema,
  imageUploadResponseSchema,
  remoteImageMetadataSchema,
  syncPullResponseSchema,
  type RemoteImageMetadata,
} from '@/lib/domain/validation';
import { z } from 'zod';
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
const imageUploads = new Map<string, Promise<boolean>>();

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

export class SessionIdentityMismatchError extends Error {
  constructor() {
    super('La sesión remota pertenece a otra cuenta; no se sincronizó ningún dato.');
    this.name = 'SessionIdentityMismatchError';
  }
}

const remoteSessionSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }).passthrough(),
  z.object({
    authenticated: z.literal(true),
    profile: z.object({ userId: z.string().uuid() }).passthrough(),
  }).passthrough(),
]);

async function assertRemoteSession(userId: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    headers: { 'x-requested-with': 'my-closet' },
    cache: 'no-store',
  });
  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error(`session HTTP ${response.status}`);
  const session = remoteSessionSchema.parse(await response.json());
  if (!session.authenticated) throw new SessionExpiredError();
  if (session.profile.userId !== userId) throw new SessionIdentityMismatchError();
}

interface PushOperationResult {
  operationId: string;
  status: 'applied' | 'conflict' | 'invalid';
  remote?: Record<string, unknown>;
}

interface PushResponse {
  results: PushOperationResult[];
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

export async function applyRemoteImageMetadata(remote: RemoteImageMetadata): Promise<boolean> {
  const db = getDB();
  const metadata = remoteImageMetadataSchema.parse(remote);
  const existing = await db.images.get(metadata.id);
  if (existing && existing.userId !== metadata.userId) return false;
  const merged: ImageRecord = {
    ...metadata,
    blob: existing?.blob ?? null,
    syncStatus: 'synced',
  };
  await db.images.put(merged);
  return true;
}

async function uploadProcessedImageOnce(imageId: string, userId: string): Promise<boolean> {
  const db = getDB();
  const image = await db.images.get(imageId);
  if (!image || image.userId !== userId || !image.blob || image.width === null || image.height === null) {
    return false;
  }

  if (image.syncStatus === 'synced' && image.remoteUrl) return true;

  const markFailed = async () => {
    const current = await db.images.get(imageId);
    if (current?.userId === userId && current.syncStatus !== 'synced') {
      await db.images.put({ ...current, syncStatus: 'failed' });
    }
  };

  try {

    const signatureResponse = await fetch(`/api/images/sign?id=${encodeURIComponent(image.id)}`, {
      headers: { 'x-requested-with': 'my-closet' },
    });
    if (signatureResponse.status === 401) throw new SessionExpiredError();
    if (signatureResponse.ok) {
      const signed = cloudinaryUploadSignatureSchema.parse(await signatureResponse.json());
      const cloudinaryForm = new FormData();
      cloudinaryForm.append('file', image.blob, `${image.id}.webp`);
      cloudinaryForm.append('api_key', signed.apiKey);
      cloudinaryForm.append('timestamp', String(signed.timestamp));
      cloudinaryForm.append('folder', signed.folder);
      cloudinaryForm.append('public_id', signed.publicId);
      cloudinaryForm.append('signature', signed.signature);
      const uploadedToCloudinary = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/image/upload`,
        { method: 'POST', body: cloudinaryForm },
      );
      if (!uploadedToCloudinary.ok) {
        await markFailed();
        return false;
      }
      const finalized = await fetch('/api/images/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'my-closet',
        },
        body: JSON.stringify({ id: image.id }),
      });
      if (finalized.status === 401) throw new SessionExpiredError();
      if (!finalized.ok) {
        await markFailed();
        return false;
      }
      const result = imageUploadResponseSchema.parse(await finalized.json());
      await applyRemoteImageMetadata(result.image);
      return true;
    }
    if (signatureResponse.status !== 501) {
      await markFailed();
      return false;
    }

    const form = new FormData();
    form.append('id', image.id);
    form.append('width', String(image.width));
    form.append('height', String(image.height));
    form.append('file', image.blob, `${image.id}.webp`);
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: { 'x-requested-with': 'my-closet' },
      body: form,
    });
    if (response.status === 401) throw new SessionExpiredError();
    if (!response.ok) {
      await markFailed();
      return false;
    }
    const uploaded = imageUploadResponseSchema.parse(await response.json());
    await applyRemoteImageMetadata(uploaded.image);
    return true;
  } catch (error) {
    await markFailed();
    throw error;
  }
}

/**
 * Sube una imagen procesada concreta. Todos los consumidores de la misma
 * imagen comparten una única promesa para evitar carreras entre la acción de
 * Perfil y el ciclo automático de sincronización.
 */
export function uploadProcessedImage(imageId: string, userId: string): Promise<boolean> {
  const key = `${userId}:${imageId}`;
  const active = imageUploads.get(key);
  if (active) return active;

  const task = uploadProcessedImageOnce(imageId, userId).finally(() => {
    if (imageUploads.get(key) === task) imageUploads.delete(key);
  });
  imageUploads.set(key, task);
  return task;
}

async function pushPendingImages(userId: string): Promise<void> {
  const db = getDB();
  const pending = (await db.images.where('syncStatus').anyOf(['pending', 'failed']).toArray())
    .filter((image) => image.userId === userId);
  for (const image of pending) {
    await uploadProcessedImage(image.id, userId);
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

  const data = syncPullResponseSchema.parse(await response.json());
  for (const image of data.images) await applyRemoteImageMetadata(image);
  for (const garment of data.garments) await applyRemoteGarment(garment);
  for (const outfit of data.outfits) await applyRemoteOutfit(outfit);
  for (const entry of data.calendarEntries) await applyRemoteCalendarEntry(entry);
  for (const share of data.wardrobeShares) await applyRemoteWardrobeShare(share);

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
  const profile = await getLocalProfile();
  if (!profile) return;
  running = true;
  notify();
  try {
    await assertRemoteSession(profile.userId);
    await releaseStaleSyncing(profile.userId);
    await pushPendingImages(profile.userId);

    // Push por lotes hasta agotar la outbox.
    for (;;) {
      const batch = await claimPendingOperations(50, profile.userId);
      if (batch.length === 0) break;
      await pushBatch(batch);
    }
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
