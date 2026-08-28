/** Web Worker de una sola operación. El cliente lo termina al recibir resultado. */
import { BACKGROUND_REMOVAL_PUBLIC_PATH } from './background-removal';
import { closeDecodedImage, decodeImageFile, encodeBitmapToWebp, type DecodedImage } from './processor';
import {
  imageWorkerMessageSchema,
  imageWorkerRequestSchema,
  type ImageProgress,
  type ImageWorkerFailureCode,
  type ImageWorkerMessage,
} from './worker-protocol';

function post(message: ImageWorkerMessage): void {
  self.postMessage(imageWorkerMessageSchema.parse(message));
}

function report(id: string, progress: ImageProgress): void {
  post({ type: 'progress', id, progress });
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Error procesando imagen';
  return message.slice(0, 500) || 'Error procesando imagen';
}

function classifyFailure(
  error: unknown,
  fallback: ImageWorkerFailureCode,
): ImageWorkerFailureCode {
  const message = readableError(error).toLowerCase();
  if (
    /out of memory|memory access out of bounds|cannot allocate|allocation failed|array buffer allocation failed/.test(
      message,
    )
  ) {
    return 'memory';
  }
  if (/failed to fetch|networkerror|load failed|resource metadata not found/.test(message)) {
    return 'resource-download';
  }
  if (/with size .* but got|unexpected end|invalid.*chunk|integrity/.test(message)) {
    return 'resource-integrity';
  }
  return fallback;
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = imageWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const { id, file, operation } = parsed.data;
  void (async () => {
    let decoded: DecodedImage | null = null;
    let failureCode: ImageWorkerFailureCode = 'decode';
    let currentStage: ImageProgress['stage'] = 'Preparando imagen';
    const reportProgress = (progress: ImageProgress) => {
      currentStage = progress.stage;
      report(id, progress);
    };
    try {
      reportProgress({ stage: 'Preparando imagen', current: null, total: null });
      decoded = await decodeImageFile(file);
      failureCode = 'processing';
      const resized = await encodeBitmapToWebp(decoded.source, decoded.width, decoded.height);

      if (operation.type === 'resize') {
        reportProgress({ stage: 'Codificando WebP', current: null, total: null });
        post({ type: 'success', id, ...resized });
        return;
      }

      failureCode = 'resource-download';
      const { removeBackground } = await import('@imgly/background-removal');
      const publicPath = new URL(BACKGROUND_REMOVAL_PUBLIC_PATH, self.location.origin).toString();
      const result = await removeBackground(resized.blob, {
        publicPath,
        device: operation.device,
        model: operation.model,
        proxyToWorker: false,
        fetchArgs: { credentials: 'same-origin' },
        output: { format: 'image/webp', quality: 0.82 },
        progress: (key: string, current: number, total: number) => {
          if (key.startsWith('fetch:')) {
            reportProgress({ stage: 'Cargando modelo local', current, total });
            return;
          }
          failureCode = 'inference';
          const stage = key === 'compute:mask'
            ? 'Aplicando transparencia'
            : key === 'compute:encode'
              ? 'Codificando WebP'
              : 'Eliminando fondo';
          reportProgress({ stage, current: null, total: null });
        },
      });
      post({
        type: 'success',
        id,
        blob: result,
        width: resized.width,
        height: resized.height,
        mimeType: 'image/webp',
      });
    } catch (error) {
      post({
        type: 'failure',
        id,
        code: classifyFailure(error, failureCode),
        stage: currentStage,
        error: readableError(error),
      });
    } finally {
      if (decoded) closeDecodedImage(decoded.source);
    }
  })();
});
