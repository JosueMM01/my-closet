/**
 * API de imágenes del cliente: procesar, persistir localmente y exponer URLs.
 * Intenta procesar en Web Worker; cae al hilo principal si no está disponible.
 */
import { ALLOWED_IMAGE_MIME_TYPES, LIMITS } from '@/lib/domain/constants';
import { uuid } from '@/lib/domain/ids';
import type { ImageRecord } from '@/lib/domain/types';
import { getDB } from '@/lib/local/db';
import { maybeSync } from '@/lib/local/sync-engine';
import { decodeImageFile, encodeBitmapToWebp, type ProcessedImage } from './processor';

let worker: Worker | null = null;
let workerBroken = false;
let requestSeq = 0;
const pendingWorkerRequests = new Map<
  number,
  { resolve: (r: ProcessedImage) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken || typeof window === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./image-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as {
        id: number;
        ok: boolean;
        blob?: Blob;
        width?: number;
        height?: number;
        error?: string;
      };
      const pending = pendingWorkerRequests.get(data.id);
      if (!pending) return;
      pendingWorkerRequests.delete(data.id);
      if (data.ok && data.blob) {
        pending.resolve({
          blob: data.blob,
          width: data.width ?? 0,
          height: data.height ?? 0,
          mimeType: 'image/webp',
        });
      } else {
        pending.reject(new Error(data.error ?? 'Error en worker de imágenes'));
      }
    });
    worker.addEventListener('error', () => {
      workerBroken = true;
      worker = null;
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function processInWorker(file: Blob): Promise<ProcessedImage> | null {
  const activeWorker = getWorker();
  if (!activeWorker) return null;
  const id = ++requestSeq;
  return new Promise<ProcessedImage>((resolve, reject) => {
    pendingWorkerRequests.set(id, { resolve, reject });
    activeWorker.postMessage({ id, file });
  });
}

async function processOnMainThread(file: Blob): Promise<ProcessedImage> {
  const { bitmap, width, height } = await decodeImageFile(file);
  const processed = await encodeBitmapToWebp(bitmap, width, height);
  bitmap.close();
  return processed;
}

export class ImageValidationError extends Error {}

/** Valida MIME y tamaño antes de cualquier procesamiento. */
export function validateImageFile(file: File): void {
  const mime = file.type || 'application/octet-stream';
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ImageValidationError(`Formato no permitido: ${mime}`);
  }
  if (file.size > LIMITS.maxUploadBytes) {
    throw new ImageValidationError(
      `La imagen supera el límite de ${Math.floor(LIMITS.maxUploadBytes / (1024 * 1024))} MB`,
    );
  }
}

/** Procesa y persiste la foto de una prenda en IndexedDB (WebP ≤1080px). */
export async function saveGarmentPhoto(userId: string, file: File): Promise<ImageRecord> {
  validateImageFile(file);
  const processed =
    (await processInWorker(file)) ?? (await processOnMainThread(file));

  const record: ImageRecord = {
    id: uuid(),
    userId,
    mimeType: processed.mimeType,
    width: processed.width,
    height: processed.height,
    byteSize: processed.blob.size,
    createdAt: new Date().toISOString(),
    blob: processed.blob,
    remoteUrl: null,
    syncStatus: 'pending',
  };
  await getDB().images.put(record);
  void maybeSync();
  return record;
}

// Cache de object URLs por id de imagen para evitar fugas y re-creaciones.
const objectUrls = new Map<string, string>();

/** URL navegable para una foto: blob local → URL remota → null. */
export async function resolveImageUrl(imageId: string | null): Promise<string | null> {
  if (!imageId) return null;
  const cached = objectUrls.get(imageId);
  if (cached) return cached;
  const record = await getDB().images.get(imageId);
  if (!record) return null;
  const url =
    record.blob && record.blob.size > 0
      ? URL.createObjectURL(record.blob)
      : record.remoteUrl;
  if (url) objectUrls.set(imageId, url);
  return url;
}

export function releaseImageUrl(imageId: string): void {
  const url = objectUrls.get(imageId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(imageId);
  }
}
