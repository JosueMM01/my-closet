/** API de procesamiento y persistencia local de fotos. */
import { ALLOWED_IMAGE_MIME_TYPES, LIMITS } from '@/lib/domain/constants';
import { uuid } from '@/lib/domain/ids';
import type { ImageRecord } from '@/lib/domain/types';
import { getDB } from '@/lib/local/db';
import { maybeSync } from '@/lib/local/sync-engine';
import { backgroundRemovalAttempts, shouldAttemptWebGpu } from './background-removal';
import {
  closeDecodedImage,
  decodeImageFile,
  detectImageFormat,
  encodeBitmapToWebp,
  type DetectedImageFormat,
  type ProcessedImage,
} from './processor';
import {
  imageProgressSchema,
  imageWorkerMessageSchema,
  imageWorkerRequestSchema,
  type ImageProgress,
  type ImageWorkerFailureCode,
  type ImageWorkerRequest,
} from './worker-protocol';

export const PROCESSED_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export interface SaveGarmentPhotoOptions {
  removeBackground?: boolean;
  /** Reserva la imagen para un flujo que controla la subida explícitamente. */
  queueForSync?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ImageProgress) => void;
}

class WorkerProcessingError extends Error {
  constructor(
    message: string,
    readonly code: ImageWorkerFailureCode | 'worker',
  ) {
    super(message);
    this.name = 'WorkerProcessingError';
  }
}

function abortError(): DOMException {
  return new DOMException('Procesamiento cancelado', 'AbortError');
}

function report(options: SaveGarmentPhotoOptions, progress: ImageProgress): void {
  options.onProgress?.(imageProgressSchema.parse(progress));
}

function runWorker(
  file: Blob,
  operation: ImageWorkerRequest['operation'],
  options: SaveGarmentPhotoOptions,
): Promise<ProcessedImage> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new WorkerProcessingError('Web Worker no disponible', 'worker'));
  }
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise<ProcessedImage>((resolve, reject) => {
    const id = uuid();
    let worker: Worker;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
      callback();
    };
    const handleAbort = () => finish(() => reject(abortError()));

    try {
      worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(new WorkerProcessingError(
        error instanceof Error ? error.message : 'No se pudo iniciar el worker de imágenes',
        'worker',
      ));
      return;
    }

    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = imageWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.id !== id) {
        finish(() => reject(new WorkerProcessingError('Respuesta inválida del worker', 'worker')));
        return;
      }
      const message = parsed.data;
      if (message.type === 'progress') {
        report(options, message.progress);
      } else if (message.type === 'success') {
        finish(() => resolve(message));
      } else {
        finish(() => reject(new WorkerProcessingError(message.error, message.code)));
      }
    });
    worker.addEventListener('error', (event) => {
      finish(() => reject(new WorkerProcessingError(event.message || 'El worker dejó de responder', 'worker')));
    });
    worker.addEventListener('messageerror', () => {
      finish(() => reject(new WorkerProcessingError('No se pudo leer la respuesta del worker', 'worker')));
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    const request = imageWorkerRequestSchema.parse({ type: 'process', id, file, operation });
    worker.postMessage(request);
  });
}

async function processOnMainThread(
  file: Blob,
  options: SaveGarmentPhotoOptions,
): Promise<ProcessedImage> {
  if (options.signal?.aborted) throw abortError();
  report(options, { stage: 'Preparando imagen', current: null, total: null });
  const { source, width, height } = await decodeImageFile(file);
  try {
    const processed = await encodeBitmapToWebp(source, width, height);
    if (options.signal?.aborted) throw abortError();
    return processed;
  } finally {
    closeDecodedImage(source);
  }
}

async function processWithBackgroundRemoval(
  file: Blob,
  options: SaveGarmentPhotoOptions,
): Promise<ProcessedImage> {
  const webGpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const attempts = backgroundRemovalAttempts(shouldAttemptWebGpu(webGpuAvailable, userAgent));
  let lastError: Error = new Error('No se pudo eliminar el fondo');
  let source: Blob = file;
  let normalizedOnMainThread = false;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (!attempt) break;
    if (index > 0) {
      report(options, {
        stage: 'Reintentando en modo compatible',
        current: index,
        total: attempts.length - 1,
      });
    }
    try {
      return await runWorker(source, attempt, options);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof WorkerProcessingError && error.code === 'decode' && !normalizedOnMainThread) {
        try {
          source = (await processOnMainThread(file, options)).blob;
          normalizedOnMainThread = true;
          index -= 1;
          continue;
        } catch {
          throw new ImageProcessingError(
            'No se pudo leer la imagen. Guárdala nuevamente como JPEG o PNG e inténtalo otra vez.',
          );
        }
      }
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw new ImageProcessingError(`No se pudo eliminar el fondo: ${lastError.message}`);
}

async function isWebp(blob: Blob): Promise<boolean> {
  if (blob.type !== 'image/webp' || blob.size < 12) return false;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  );
}

export async function validateProcessedImage(processed: ProcessedImage): Promise<void> {
  if (!(await isWebp(processed.blob))) {
    throw new ImageProcessingError('El navegador no produjo una imagen WebP válida');
  }
  if (processed.blob.size > PROCESSED_IMAGE_MAX_BYTES) {
    throw new ImageProcessingError('La imagen procesada supera el límite de sincronización de 3 MB');
  }
  if (processed.width > LIMITS.processedImageMaxDimension || processed.height > LIMITS.processedImageMaxDimension) {
    throw new ImageProcessingError('La imagen procesada supera 1080 px');
  }
}

export class ImageValidationError extends Error {}
export class ImageProcessingError extends Error {}

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

const MIME_BY_FORMAT: Record<DetectedImageFormat, readonly string[]> = {
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  avif: ['image/avif'],
  heif: ['image/heic', 'image/heif'],
};

export async function validateImageContent(file: File): Promise<DetectedImageFormat> {
  const format = await detectImageFormat(file);
  if (!format) {
    throw new ImageValidationError(
      'El contenido del archivo no corresponde a una imagen JPEG, PNG, WebP, HEIC o AVIF válida.',
    );
  }
  if (!MIME_BY_FORMAT[format].includes(file.type)) {
    throw new ImageValidationError(
      `La extensión o el tipo declarado (${file.type || 'desconocido'}) no coincide con el formato real (${format.toUpperCase()}).`,
    );
  }
  return format;
}

/** Procesa y persiste la foto en IndexedDB solo después de validar el resultado. */
export async function saveGarmentPhoto(
  userId: string,
  file: File,
  options: SaveGarmentPhotoOptions = {},
): Promise<ImageRecord> {
  validateImageFile(file);
  await validateImageContent(file);
  let processed: ProcessedImage;

  if (options.removeBackground === true) {
    processed = await processWithBackgroundRemoval(file, options);
  } else {
    try {
      processed = await runWorker(file, { type: 'resize' }, options);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      processed = await processOnMainThread(file, options);
    }
  }

  await validateProcessedImage(processed);
  if (options.signal?.aborted) throw abortError();

  const record: ImageRecord = {
    id: uuid(),
    userId,
    mimeType: 'image/webp',
    width: processed.width,
    height: processed.height,
    byteSize: processed.blob.size,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blob: processed.blob,
    remoteUrl: null,
    storageProvider: 'local',
    storageKey: null,
    syncStatus: options.queueForSync === false ? 'syncing' : 'pending',
  };
  await getDB().images.put(record);
  if (options.queueForSync !== false) void maybeSync();
  return record;
}

/** Reemplaza el blob local de una imagen sin iniciar una subida remota. */
export async function replaceLocalImageBlob(
  imageId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<ImageRecord> {
  const processed = { blob, width, height, mimeType: 'image/webp' as const };
  await validateProcessedImage(processed);
  const current = await getDB().images.get(imageId);
  if (!current) throw new ImageProcessingError('La imagen local ya no está disponible');
  const updated: ImageRecord = {
    ...current,
    width,
    height,
    byteSize: blob.size,
    updatedAt: new Date().toISOString(),
    blob,
    remoteUrl: null,
    storageProvider: 'local',
    storageKey: null,
    syncStatus: 'syncing',
  };
  await getDB().images.put(updated);
  return updated;
}
