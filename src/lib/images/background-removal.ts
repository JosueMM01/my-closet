import type { ImageWorkerFailureCode, ImageWorkerRequest } from './worker-protocol';

export const BACKGROUND_REMOVAL_PUBLIC_PATH = '/vendor/background-removal/1.7.0-adaptive-v1/';

export type BackgroundRemovalAttempt = Extract<
  ImageWorkerRequest['operation'],
  { type: 'remove-background' }
>;

export interface BackgroundRemovalCapabilities {
  webGpuAdapter: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  storageHeadroomBytes: number | null;
}

export interface BackgroundRemovalHistory {
  preferred: BackgroundRemovalAttempt | null;
  failures: Record<string, number>;
}

export const EMPTY_BACKGROUND_REMOVAL_HISTORY: BackgroundRemovalHistory = {
  preferred: null,
  failures: {},
};

export function backgroundRemovalAttemptKey(attempt: BackgroundRemovalAttempt): string {
  return `${attempt.device}:${attempt.model}`;
}

/** Un adaptador disponible no demuestra que el driver Android produzca resultados estables. */
export function shouldAttemptWebGpu(
  capabilities: BackgroundRemovalCapabilities,
  history: BackgroundRemovalHistory,
): boolean {
  if (!capabilities.webGpuAdapter) return false;
  const gpuFailures = Object.entries(history.failures)
    .filter(([key]) => key.startsWith('gpu:'))
    .reduce((total, [, count]) => total + count, 0);
  if (gpuFailures >= 2) return false;
  if (!capabilities.isAndroid) return true;
  return history.preferred?.device === 'gpu';
}

export function isLimitedImageDevice(capabilities: BackgroundRemovalCapabilities): boolean {
  return (
    (capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 4) ||
    capabilities.hardwareConcurrency <= 4 ||
    (capabilities.storageHeadroomBytes !== null &&
      capabilities.storageHeadroomBytes < 160 * 1024 * 1024) ||
    (capabilities.isMobile &&
      capabilities.deviceMemoryGb === null &&
      capabilities.hardwareConcurrency <= 6)
  );
}

/** Cada intento usa un worker nuevo; los fallos repetidos se omiten en fotos posteriores. */
export function backgroundRemovalAttempts(
  capabilities: BackgroundRemovalCapabilities,
  history: BackgroundRemovalHistory = EMPTY_BACKGROUND_REMOVAL_HISTORY,
): BackgroundRemovalAttempt[] {
  // Un móvil con 8 GB tampoco garantiza memoria disponible para el navegador.
  // El historial exitoso se conserva; dispositivos nuevos empiezan por la CPU ligera.
  const smallerCpuFirst = capabilities.isMobile || isLimitedImageDevice(capabilities);
  const candidates: BackgroundRemovalAttempt[] = [
    ...(shouldAttemptWebGpu(capabilities, history)
      ? [{ type: 'remove-background', device: 'gpu', model: 'isnet' } as const]
      : []),
    ...(smallerCpuFirst
      ? [
          { type: 'remove-background', device: 'cpu', model: 'isnet_quint8' } as const,
          { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' } as const,
        ]
      : [
          { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' } as const,
          { type: 'remove-background', device: 'cpu', model: 'isnet_quint8' } as const,
        ]),
  ];
  const preferredKey = history.preferred
    ? backgroundRemovalAttemptKey(history.preferred)
    : null;
  const ordered = history.preferred && candidates.some(
    (attempt) => backgroundRemovalAttemptKey(attempt) === preferredKey,
  )
    ? [history.preferred, ...candidates.filter(
        (attempt) => backgroundRemovalAttemptKey(attempt) !== preferredKey,
      )]
    : candidates;
  const healthy = ordered.filter(
    (attempt) => (history.failures[backgroundRemovalAttemptKey(attempt)] ?? 0) < 2,
  );
  return healthy;
}

export function shouldRetrySameAttempt(
  code: ImageWorkerFailureCode | 'worker',
  online: boolean,
  retries: number,
): boolean {
  return online && retries < 1 && (code === 'resource-download' || code === 'resource-integrity');
}

export function shouldTryNextAttempt(
  code: ImageWorkerFailureCode | 'worker',
  current: BackgroundRemovalAttempt,
): boolean {
  if (code !== 'memory' && code !== 'worker') return true;
  return current.model !== 'isnet_quint8';
}
