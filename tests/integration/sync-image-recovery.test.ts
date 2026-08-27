import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '@/lib/local/db';
import { uploadProcessedImage } from '@/lib/local/sync-engine';

const USER = '11111111-1111-4111-8111-111111111111';
const IMAGE = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-08-25T00:00:00.000Z';

function signatureResponse(): Response {
  return Response.json({
    cloudName: 'test-cloud',
    apiKey: 'test-key',
    timestamp: 1_787_702_400,
    signature: 'a'.repeat(40),
    folder: `my-closet/${USER}`,
    publicId: IMAGE,
  });
}

function finalizedResponse(): Response {
  return Response.json({
    image: {
      id: IMAGE,
      userId: USER,
      mimeType: 'image/webp',
      width: 20,
      height: 30,
      byteSize: 4,
      remoteUrl: `https://res.cloudinary.com/test/image/upload/${IMAGE}.webp`,
      storageProvider: 'cloudinary',
      storageKey: `my-closet/${USER}/${IMAGE}`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await getDB().images.clear();
  await getDB().images.put({
    id: IMAGE,
    userId: USER,
    mimeType: 'image/webp',
    width: 20,
    height: 30,
    byteSize: 4,
    createdAt: NOW,
    updatedAt: NOW,
    blob: new Blob(['webp'], { type: 'image/webp' }),
    remoteUrl: null,
    storageProvider: 'local',
    storageKey: null,
    syncStatus: 'pending',
  });
});

describe('recuperación de subida de imágenes', () => {
  it('conserva la imagen tras perder conexión y permite reintentar', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline')));

    await expect(uploadProcessedImage(IMAGE, USER)).rejects.toThrow('offline');
    await expect(getDB().images.get(IMAGE)).resolves.toMatchObject({
      userId: USER,
      syncStatus: 'failed',
      blob: expect.any(Blob),
    });

    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/images/sign')) return new Response(null, { status: 501 });
      if (url === '/api/images') return finalizedResponse();
      throw new Error(`Solicitud inesperada: ${url}`);
    }));

    await expect(uploadProcessedImage(IMAGE, USER)).resolves.toBe(true);
    await expect(getDB().images.get(IMAGE)).resolves.toMatchObject({
      userId: USER,
      syncStatus: 'synced',
      blob: expect.any(Blob),
      storageProvider: 'cloudinary',
    });
  });

  it('reintenta finalize con el mismo id y evita trabajo concurrente duplicado', async () => {
    let finalizeAttempts = 0;
    let cloudinaryUploads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/images/sign')) return signatureResponse();
      if (url.startsWith('https://api.cloudinary.com/')) {
        cloudinaryUploads += 1;
        return Response.json({ secure_url: 'https://example.test/image.webp' });
      }
      if (url === '/api/images/finalize') {
        finalizeAttempts += 1;
        return finalizeAttempts === 1
          ? new Response(null, { status: 503 })
          : finalizedResponse();
      }
      throw new Error(`Solicitud inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = uploadProcessedImage(IMAGE, USER);
    expect(uploadProcessedImage(IMAGE, USER)).toBe(first);
    await expect(first).resolves.toBe(false);
    await expect(getDB().images.get(IMAGE)).resolves.toMatchObject({ syncStatus: 'failed' });

    await expect(uploadProcessedImage(IMAGE, USER)).resolves.toBe(true);
    expect(finalizeAttempts).toBe(2);
    expect(cloudinaryUploads).toBe(2);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('undefined'))).toBe(true);
    await expect(getDB().images.get(IMAGE)).resolves.toMatchObject({
      id: IMAGE,
      syncStatus: 'synced',
      storageKey: `my-closet/${USER}/${IMAGE}`,
    });
  });
});
