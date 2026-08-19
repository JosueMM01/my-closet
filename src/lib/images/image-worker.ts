/** Web Worker de una sola operación. El cliente lo termina al recibir resultado. */
import { BACKGROUND_REMOVAL_PUBLIC_PATH } from './background-removal';
import { decodeImageFile, encodeBitmapToWebp } from './processor';
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

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = imageWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const { id, file, operation } = parsed.data;
  void (async () => {
    let bitmap: ImageBitmap | null = null;
    let failureCode: ImageWorkerFailureCode = 'processing';
    try {
      report(id, { stage: 'Preparando imagen', current: null, total: null });
      const decoded = await decodeImageFile(file);
      bitmap = decoded.bitmap;
      const resized = await encodeBitmapToWebp(bitmap, decoded.width, decoded.height);

      if (operation.type === 'resize') {
        report(id, { stage: 'Codificando WebP', current: null, total: null });
        post({ type: 'success', id, ...resized });
        return;
      }

      failureCode = 'resource';
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
            report(id, { stage: 'Descargando modelo local', current, total });
            return;
          }
          failureCode = 'inference';
          const stage = key === 'compute:mask'
            ? 'Aplicando transparencia'
            : key === 'compute:encode'
              ? 'Codificando WebP'
              : 'Eliminando fondo';
          report(id, { stage, current: null, total: null });
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
        code: failureCode,
        error: readableError(error),
      });
    } finally {
      bitmap?.close();
    }
  })();
});
