/** API de procesamiento y persistencia local de fotos. */
import { ALLOWED_IMAGE_MIME_TYPES, LIMITS } from '@/lib/domain/constants';
import { uuid } from '@/lib/domain/ids';
import type { ImageRecord } from '@/lib/domain/types';
import { getDB } from '@/lib/local/db';
import { maybeSync } from '@/lib/local/sync-engine';
import {
  backgroundRemovalAttempts,
  shouldRetrySameAttempt,
  shouldTryNextAttempt,
  type BackgroundRemovalAttempt,
  type BackgroundRemovalCapabilities,
} from './background-removal';
import {
  capabilitySnapshot,
  readBackgroundRemovalHistory,
  recordBackgroundRemovalFailure,
  recordBackgroundRemovalSuccess,
  writeBackgroundRemovalDiagnostic,
  type BackgroundRemovalAttemptDiagnostic,
  type BackgroundRemovalDiagnostic,
} from './background-removal-state';
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
  onBackgroundRemovalFallback?: (
    message: string,
    diagnostic: BackgroundRemovalDiagnostic,
  ) => void;
}

class WorkerProcessingError extends Error {
  constructor(
    message: string,
    readonly code: ImageWorkerFailureCode | 'worker',
    readonly stage: ImageProgress['stage'],
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
    return Promise.reject(
      new WorkerProcessingError('Web Worker no disponible', 'worker', 'Preparando imagen'),
    );
  }
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise<ProcessedImage>((resolve, reject) => {
    const id = uuid();
    let worker: Worker;
    let settled = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStage: ImageProgress['stage'] = 'Preparando imagen';

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      options.signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
      callback();
    };
    const handleAbort = () => finish(() => reject(abortError()));
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        finish(() => reject(new WorkerProcessingError(
          'El proceso aislado dejó de responder; el navegador pudo haberlo cerrado por falta de recursos.',
          'worker',
          lastStage,
        )));
      }, 180_000);
    };

    try {
      worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(new WorkerProcessingError(
        error instanceof Error ? error.message : 'No se pudo iniciar el worker de imágenes',
        'worker',
        'Preparando imagen',
      ));
      return;
    }

    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = imageWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.id !== id) {
        finish(() => reject(new WorkerProcessingError(
          'Respuesta inválida del worker',
          'worker',
          lastStage,
        )));
        return;
      }
      const message = parsed.data;
      if (message.type === 'progress') {
        lastStage = message.progress.stage;
        resetInactivityTimer();
        report(options, message.progress);
      } else if (message.type === 'success') {
        finish(() => resolve(message));
      } else {
        finish(() => reject(new WorkerProcessingError(message.error, message.code, message.stage)));
      }
    });
    worker.addEventListener('error', (event) => {
      finish(() => reject(new WorkerProcessingError(
        event.message ||
          'El proceso aislado terminó inesperadamente; probablemente el navegador agotó recursos.',
        'worker',
        lastStage,
      )));
    });
    worker.addEventListener('messageerror', () => {
      finish(() => reject(new WorkerProcessingError(
        'No se pudo leer la respuesta del proceso aislado',
        'worker',
        lastStage,
      )));
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    const request = imageWorkerRequestSchema.parse({ type: 'process', id, file, operation });
    resetInactivityTimer();
    worker.postMessage(request);
  });
}

type NavigatorWithImageCapabilities = Navigator & {
  deviceMemory?: number;
  gpu?: { requestAdapter: () => Promise<unknown | null> };
};

async function detectBackgroundRemovalCapabilities(): Promise<BackgroundRemovalCapabilities> {
  if (typeof navigator === 'undefined') {
    return capabilitySnapshot({
      webGpuAdapter: false,
      isAndroid: false,
      isMobile: false,
      deviceMemoryGb: null,
      hardwareConcurrency: 1,
      storageHeadroomBytes: null,
    });
  }
  const candidate = navigator as NavigatorWithImageCapabilities;
  const userAgent = navigator.userAgent;
  let webGpuAdapter = false;
  if (candidate.gpu) {
    try {
      webGpuAdapter = Boolean(await Promise.race([
        candidate.gpu.requestAdapter(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
      ]));
    } catch {
      webGpuAdapter = false;
    }
  }
  let storageHeadroomBytes: number | null = null;
  try {
    const estimate = await candidate.storage?.estimate();
    if (estimate?.quota !== undefined && estimate.usage !== undefined) {
      storageHeadroomBytes = Math.max(0, estimate.quota - estimate.usage);
    }
  } catch {
    storageHeadroomBytes = null;
  }
  return capabilitySnapshot({
    webGpuAdapter,
    isAndroid: /Android/i.test(userAgent),
    isMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent),
    deviceMemoryGb:
      typeof candidate.deviceMemory === 'number' && candidate.deviceMemory > 0
        ? candidate.deviceMemory
        : null,
    hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 1),
    storageHeadroomBytes,
  });
}

async function releasePreviousWorker(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}

async function clearBackgroundRemovalModelCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete('mc-background-removal-1.7.0-adaptive-v1');
  } catch {
    // La caché es una optimización; el siguiente fetch aún puede usar la red.
  }
}

function friendlyBackgroundRemovalFailure(error: WorkerProcessingError): string {
  switch (error.code) {
    case 'resource-download':
      return 'no se pudieron descargar los archivos del modelo';
    case 'resource-integrity':
      return 'los archivos del modelo almacenados estaban incompletos';
    case 'memory':
      return 'ONNX no pudo reservar la memoria necesaria';
    case 'worker':
      return 'el navegador cerró el proceso aislado, probablemente por presión de recursos';
    case 'inference':
      return 'el modelo falló durante la inferencia';
    case 'decode':
      return 'el navegador no pudo decodificar la imagen';
    default:
      return 'el navegador no pudo preparar la imagen';
  }
}

function diagnosticEntry(
  attempt: BackgroundRemovalAttempt,
  outcome: 'success' | 'failure',
  error: WorkerProcessingError | null,
  startedAt: number,
  retries: number,
): BackgroundRemovalAttemptDiagnostic {
  return {
    attempt,
    outcome,
    code: error?.code ?? null,
    stage: error?.stage ?? 'Codificando WebP',
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    retries,
    detail: error?.message.slice(0, 300) ?? null,
  };
}

async function persistDiagnostic(diagnostic: BackgroundRemovalDiagnostic): Promise<void> {
  try {
    await writeBackgroundRemovalDiagnostic(diagnostic);
  } catch (error) {
    console.warn('[My Closet][background-removal] No se pudo guardar el diagnóstico.', error);
  }
}

async function rememberSuccessfulAttempt(attempt: BackgroundRemovalAttempt): Promise<void> {
  try {
    await recordBackgroundRemovalSuccess(attempt);
  } catch (error) {
    console.warn('[My Closet][background-removal] No se pudo recordar la ruta exitosa.', error);
  }
}

async function rememberFailedAttempt(attempt: BackgroundRemovalAttempt): Promise<void> {
  try {
    await recordBackgroundRemovalFailure(attempt);
  } catch (error) {
    console.warn('[My Closet][background-removal] No se pudo recordar la ruta fallida.', error);
  }
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
  format: DetectedImageFormat,
  options: SaveGarmentPhotoOptions,
): Promise<{
  processed: ProcessedImage | null;
  fallbackMessage: string | null;
  diagnostic: BackgroundRemovalDiagnostic;
}> {
  const capabilities = await detectBackgroundRemovalCapabilities();
  const history = await readBackgroundRemovalHistory();
  const attempts = backgroundRemovalAttempts(capabilities, history);
  const diagnostic: BackgroundRemovalDiagnostic = {
    id: uuid(),
    startedAt: new Date().toISOString(),
    capabilities,
    attempts: [],
    result: 'failed',
    finalMessage: null,
  };
  let lastError = new WorkerProcessingError(
    'No se pudo eliminar el fondo',
    'worker',
    'Preparando imagen',
  );
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
    let retries = 0;
    while (true) {
      const attemptStartedAt = performance.now();
      try {
        const processed = await runWorker(source, attempt, options);
        diagnostic.attempts.push(diagnosticEntry(attempt, 'success', null, attemptStartedAt, retries));
        diagnostic.result = 'automatic';
        await rememberSuccessfulAttempt(attempt);
        await persistDiagnostic(diagnostic);
        return { processed, fallbackMessage: null, diagnostic };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        const workerError = error instanceof WorkerProcessingError
          ? error
          : new WorkerProcessingError(
              error instanceof Error ? error.message : 'Fallo desconocido del proceso aislado',
              'worker',
              'Preparando imagen',
            );
        diagnostic.attempts.push(
          diagnosticEntry(attempt, 'failure', workerError, attemptStartedAt, retries),
        );

        if (workerError.code === 'decode' && !normalizedOnMainThread) {
          try {
            source = (await processOnMainThread(file, options)).blob;
            normalizedOnMainThread = true;
            await releasePreviousWorker();
            continue;
          } catch {
            const message = format === 'heif'
              ? 'Este navegador no pudo leer la foto HEIC/HEIF. Conviértela a JPEG o PNG antes de cargarla.'
              : 'El navegador no pudo decodificar esta imagen. Guárdala nuevamente como JPEG o PNG e inténtalo otra vez.';
            diagnostic.finalMessage = message;
            await persistDiagnostic(diagnostic);
            throw new ImageProcessingError(message);
          }
        }

        lastError = workerError;
        if (shouldRetrySameAttempt(workerError.code, navigator.onLine, retries)) {
          retries += 1;
          report(options, {
            stage: 'Reintentando descarga del modelo',
            current: retries,
            total: 1,
          });
          await clearBackgroundRemovalModelCache();
          await releasePreviousWorker();
          continue;
        }
        if (
          workerError.code === 'memory' ||
          workerError.code === 'inference' ||
          workerError.code === 'worker'
        ) {
          await rememberFailedAttempt(attempt);
        }
        await releasePreviousWorker();
        if (!shouldTryNextAttempt(workerError.code, attempt)) index = attempts.length;
        break;
      }
    }
  }
  const reason = attempts.length === 0
    ? 'las rutas compatibles fallaron repetidamente en este dispositivo'
    : friendlyBackgroundRemovalFailure(lastError);
  const fallbackMessage = `La eliminación automática no pudo completarse porque ${reason}. Se conservó la foto para que puedas guardarla o corregirla con el editor manual. Diagnóstico: ${diagnostic.id.slice(0, 8)}.`;
  diagnostic.result = 'manual-original';
  diagnostic.finalMessage = fallbackMessage;
  await persistDiagnostic(diagnostic);
  return { processed: null, fallbackMessage, diagnostic };
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
  const format = await validateImageContent(file);
  let processed: ProcessedImage;

  if (options.removeBackground === true) {
    const removal = await processWithBackgroundRemoval(file, format, options);
    if (removal.processed) {
      processed = removal.processed;
    } else {
      report(options, {
        stage: 'Usando foto sin eliminación automática',
        current: null,
        total: null,
      });
      processed = await processOnMainThread(file, options);
      if (removal.fallbackMessage) {
        options.onBackgroundRemovalFallback?.(removal.fallbackMessage, removal.diagnostic);
      }
    }
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
