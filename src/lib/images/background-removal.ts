import type { ImageWorkerRequest } from './worker-protocol';

export const BACKGROUND_REMOVAL_PUBLIC_PATH = '/vendor/background-removal/1.7.0/';

export type BackgroundRemovalAttempt = Extract<
  ImageWorkerRequest['operation'],
  { type: 'remove-background' }
>;

/** WebGPU móvil todavía presenta resultados corruptos en algunos drivers Android. */
export function shouldAttemptWebGpu(hasWebGpu: boolean, userAgent: string): boolean {
  return hasWebGpu && !/Android/i.test(userAgent);
}

/** Cada intento se ejecuta en un worker nuevo para aislar el runtime ONNX. */
export function backgroundRemovalAttempts(webGpuAvailable: boolean): BackgroundRemovalAttempt[] {
  return [
    ...(webGpuAvailable
      ? [{ type: 'remove-background', device: 'gpu', model: 'isnet' } as const]
      : []),
    { type: 'remove-background', device: 'cpu', model: 'isnet' },
    { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' },
  ];
}
