import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { imageUploadResponseSchema } from '@/lib/domain/validation';
import { toRemoteImageMetadata } from '@/server/images/storage';

describe('contrato de metadatos de imagen', () => {
  it('no expone el campo interno data al finalizar una subida', () => {
    const now = new Date().toISOString();
    const image = toRemoteImageMetadata({
      id: randomUUID(),
      userId: randomUUID(),
      mimeType: 'image/webp',
      width: 320,
      height: 320,
      byteSize: 1_024,
      data: null,
      remoteUrl: 'https://res.cloudinary.com/example/image/upload/avatar.webp',
      storageProvider: 'cloudinary',
      storageKey: 'my-closet/user/avatar',
      createdAt: now,
      updatedAt: now,
    });

    expect(image).not.toHaveProperty('data');
    expect(() => imageUploadResponseSchema.parse({ image })).not.toThrow();
  });
});
