import { describe, expect, it } from 'vitest';
import { classifyImageWorkerFailure, imageWorkerInactivityLimit } from '@/lib/images/worker-failure';
import { shouldRetrySameAttempt, shouldTryNextAttempt } from '@/lib/images/background-removal';

describe('fallos del motor local', () => {
  it.each([
    ['Failed to create session: unsupported operator', 'session'],
    ['WebAssembly.CompileError: refused to compile', 'session'],
    ['no available backend found', 'session'],
    ['Failed to create session: out of memory', 'memory'],
    ['Failed to create session: Failed to fetch', 'resource-download'],
    ['Failed to fetch', 'resource-download'],
    ['resource with size 100 but got 40', 'resource-integrity'],
  ] as const)('clasifica %s como %s', (message, code) => {
    expect(classifyImageWorkerFailure(new Error(message), 'resource-download')).toBe(code);
  });
  it('no descarga nuevamente por sesión, inferencia o timeout', () => {
    for (const code of ['session', 'inference', 'timeout'] as const) {
      expect(shouldRetrySameAttempt(code, true, 0)).toBe(false);
    }
    expect(shouldTryNextAttempt('timeout', { type: 'remove-background', device: 'cpu', model: 'isnet_quint8' })).toBe(false);
  });
  it('da margen acotado a inferencia sin desactivar el timeout de descarga', () => {
    expect(imageWorkerInactivityLimit('Eliminando fondo')).toBe(300_000);
    expect(imageWorkerInactivityLimit('Cargando modelo local')).toBe(180_000);
  });
});
