import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '@/lib/local/db';
import { saveGarmentPhoto } from '@/lib/images/image-client';
import { readLastBackgroundRemovalDiagnostic, recordBackgroundRemovalFailure } from '@/lib/images/background-removal-state';
import type { ImageWorkerRequest } from '@/lib/images/worker-protocol';

vi.mock('@/lib/local/sync-engine', () => ({ maybeSync: vi.fn() }));
vi.mock('@/lib/images/processor', async (original) => ({
  ...await original<typeof import('@/lib/images/processor')>(),
  decodeImageFile: vi.fn(async () => ({ source: {}, width: 20, height: 20 })),
  closeDecodedImage: vi.fn(),
  encodeBitmapToWebp: vi.fn(async () => result()),
}));

function result() {
  return { blob: new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])], { type: 'image/webp' }),
    width: 20, height: 20, mimeType: 'image/webp' as const };
}
const file = () => new File([new Uint8Array([255, 216, 255, 224])], 'foto.jpg', { type: 'image/jpeg' });
type Scenario = 'session' | 'download-once' | 'slow' | 'timeout' | 'success';
let scenario: Scenario;
const workers: TestWorker[] = [];
class TestWorker extends EventTarget {
  request?: ImageWorkerRequest;
  terminate = vi.fn();
  constructor() { super(); workers.push(this); }
  postMessage(request: ImageWorkerRequest) {
    this.request = request;
    const send = (body: object) => this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, ...body } }));
    if (scenario === 'session') {
      setTimeout(() => send({ type: 'failure', code: 'session', stage: 'Cargando modelo local', error: 'Failed to create session' }), 1);
    } else if (scenario === 'download-once' && workers.length === 1) {
      setTimeout(() => send({ type: 'failure', code: 'resource-download', stage: 'Cargando modelo local', error: 'Failed to fetch' }), 1);
    } else if (scenario === 'slow' || scenario === 'timeout') {
      setTimeout(() => send({ type: 'progress', progress: { stage: 'Eliminando fondo', current: null, total: null } }), 1);
      if (scenario === 'slow') setTimeout(() => send({ type: 'success', ...result() }), 200_000);
    } else setTimeout(() => send({ type: 'success', ...result() }), 1);
  }
}
const deleteCache = vi.fn(async () => true);
beforeEach(async () => {
  await getDB().kv.clear(); await getDB().images.clear();
  workers.length = 0; scenario = 'success'; deleteCache.mockClear();
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('navigator', { userAgent: 'Android', hardwareConcurrency: 8, onLine: true });
  vi.stubGlobal('caches', { delete: deleteCache });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function process(ignoreBackgroundRemovalHistory = false) {
  const promise = saveGarmentPhoto('test-user', file(), { removeBackground: true, queueForSync: false, ignoreBackgroundRemovalHistory });
  let completed = false;
  void promise.then(() => { completed = true; });
  // IndexedDB usa eventos reales; permitir iniciar el Worker antes del reloj simulado.
  await vi.waitFor(() => expect(workers.length).toBeGreaterThan(0));
  await vi.waitFor(async () => {
    await vi.runAllTimersAsync();
    expect(completed).toBe(true);
  }, { timeout: 2000, interval: 10 });
  return promise;
}
describe('recuperación de Worker', () => {
  it('no purga caché ni reintenta descarga al fallar la sesión ONNX', async () => {
    scenario = 'session'; await process();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(workers).toHaveLength(2);
    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    const diagnostic = await readLastBackgroundRemovalDiagnostic();
    expect(diagnostic?.result).toBe('manual-original');
    expect(diagnostic?.attempts.map(attempt => attempt.code)).toEqual(['session', 'session']);
    expect(await getDB().images.count()).toBe(1);
  });
  it('reintenta una descarga transitoria y libera el Worker anterior', async () => {
    scenario = 'download-once'; await process();
    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect((await readLastBackgroundRemovalDiagnostic())?.result).toBe('automatic');
  });
  it('permite una inferencia viva superior a tres minutos', async () => {
    scenario = 'slow'; await process();
    const diagnostic = await readLastBackgroundRemovalDiagnostic();
    expect(diagnostic?.result).toBe('automatic');
    expect(diagnostic?.attempts[0]?.stageDurationsMs?.['Eliminando fondo']).toBeGreaterThan(180_000);
    expect(workers).toHaveLength(1);
  });
  it('un timeout conserva la foto y no escala de quint8 a un modelo mayor', async () => {
    scenario = 'timeout'; await process();
    expect(workers).toHaveLength(1);
    expect((await readLastBackgroundRemovalDiagnostic())?.attempts[0]?.code).toBe('timeout');
    expect((await readLastBackgroundRemovalDiagnostic())?.result).toBe('manual-original');
  });
  it('el reintento explícito ignora vetos sin borrar la caché', async () => {
    for (const model of ['isnet_quint8', 'isnet_fp16'] as const) {
      const attempt = { type: 'remove-background', device: 'cpu', model } as const;
      await recordBackgroundRemovalFailure(attempt); await recordBackgroundRemovalFailure(attempt);
    }
    await process(true);
    expect(workers[0]?.request?.operation).toMatchObject({ model: 'isnet_quint8' });
    expect(deleteCache).not.toHaveBeenCalled();
  });
});
