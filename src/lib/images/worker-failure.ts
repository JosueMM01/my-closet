import type { ImageProgress, ImageWorkerFailureCode } from './worker-protocol';

/** Solo la red o la integridad justifican volver a descargar el modelo. */
export function classifyImageWorkerFailure(error: unknown, fallback: ImageWorkerFailureCode): ImageWorkerFailureCode {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/out of memory|memory access out of bounds|cannot allocate|allocation failed|array buffer allocation failed/.test(message)) return 'memory';
  if (/failed to fetch|networkerror|load failed|resource metadata not found/.test(message)) return 'resource-download';
  if (/with size .* but got|unexpected end|invalid.*chunk|integrity/.test(message)) return 'resource-integrity';
  if (/failed to create session|no available backend|webassembly|wasm.*compil|compileerror/.test(message)) return 'session';
  return fallback;
}

export function imageWorkerInactivityLimit(stage: ImageProgress['stage']): number {
  // IMG.LY no emite progreso entre compute:inference y compute:mask.
  // Margen acotado; nunca un heartbeat que oculte una inferencia bloqueada.
  return stage === 'Eliminando fondo' ? 300_000 : 180_000;
}
