/**
 * Web Worker de procesamiento de imágenes: descarga el trabajo pesado
 * (decode + resize + encode WebP) del hilo principal de la UI.
 */
import { decodeImageFile, encodeBitmapToWebp } from './processor';

export interface WorkerRequest {
  id: number;
  file: Blob;
}

export type WorkerResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number; mimeType: 'image/webp' }
  | { id: number; ok: false; error: string };

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data;
  void (async () => {
    try {
      const { bitmap, width, height } = await decodeImageFile(file);
      const processed = await encodeBitmapToWebp(bitmap, width, height);
      bitmap.close();
      const response: WorkerResponse = {
        id,
        ok: true,
        blob: processed.blob,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
      };
      self.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : 'Error procesando imagen',
      };
      self.postMessage(response);
    }
  })();
});
