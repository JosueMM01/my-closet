import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ close: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/images/processor', () => ({
  decodeImageFile: vi.fn(async () => ({ source: {}, width: 4000, height: 3000 })),
  encodeBitmapToWebp: vi.fn(async () => ({ blob: new Blob(['reduced']), width: 1080, height: 810, mimeType: 'image/webp' })),
  closeDecodedImage: mocks.close,
}));
vi.mock('@imgly/background-removal', () => ({ removeBackground: mocks.remove }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });
describe('memoria del Worker de imágenes', () => {
  it('libera el bitmap original antes de cargar/inferir y no lo cierra dos veces', async () => {
    const worker = new EventTarget();
    const post = vi.fn();
    vi.stubGlobal('self', { addEventListener: worker.addEventListener.bind(worker),
      postMessage: post, location: { origin: 'http://localhost' } });
    mocks.remove.mockImplementation(async () => {
      expect(mocks.close).toHaveBeenCalledOnce();
      return new Blob(['transparent'], { type: 'image/webp' });
    });
    await import('@/lib/images/image-worker');
    worker.dispatchEvent(new MessageEvent('message', { data: {
      type: 'process', id: crypto.randomUUID(), file: new Blob(['photo']),
      operation: { type: 'remove-background', device: 'cpu', model: 'isnet_quint8' },
    } }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
