/**
 * ImageStorage: abstracción de almacenamiento de imágenes del servidor.
 *  - LocalImageStorage: blobs en SQLite (desarrollo; TODO funciona sin cuenta).
 *  - CloudinaryImageStorage: subida firmada vía REST (activa solo con env).
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { RemoteImageMetadata } from '@/lib/domain/validation';
import {
  getCloudinaryCredentials,
  type CloudinaryCredentials,
} from '@/server/env';
import { getSqlite, sqliteSchema } from '@/server/db';

export interface ImagePutInput {
  id: string;
  userId: string;
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageStorage {
  readonly kind: 'local' | 'cloudinary';
  put(input: ImagePutInput): Promise<RemoteImageMetadata>;
  get(id: string): Promise<{ data: Buffer; mimeType: string } | null>;
}

class LocalImageStorage implements ImageStorage {
  readonly kind = 'local' as const;

  async put(input: ImagePutInput): Promise<RemoteImageMetadata> {
    const sqlite = await getSqlite();
    const existing = await sqlite
      .select()
      .from(sqliteSchema.images)
      .where(eq(sqliteSchema.images.id, input.id))
      .limit(1);
    if (existing[0] && existing[0].userId !== input.userId) throw new ImageOwnershipError();
    const now = new Date().toISOString();
    const remoteUrl = `/api/images/${input.id}`;
    const values = {
      id: input.id,
      userId: input.userId,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      data: input.data,
      remoteUrl,
      storageProvider: this.kind,
      storageKey: input.id,
      createdAt: existing[0]?.createdAt ?? now,
      updatedAt: now,
    };
    const written = await sqlite
      .insert(sqliteSchema.images)
      .values(values)
      .onConflictDoUpdate({
        target: sqliteSchema.images.id,
        set: values,
        setWhere: eq(sqliteSchema.images.userId, input.userId),
      })
      .returning({ userId: sqliteSchema.images.userId });
    if (!written[0]) throw new ImageOwnershipError();
    return {
      id: input.id,
      userId: input.userId,
      mimeType: 'image/webp',
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      remoteUrl,
      storageProvider: this.kind,
      storageKey: input.id,
      createdAt: values.createdAt,
      updatedAt: now,
    };
  }

  async get(id: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const sqlite = await getSqlite();
    const rows = await sqlite
      .select({ data: sqliteSchema.images.data, mimeType: sqliteSchema.images.mimeType })
      .from(sqliteSchema.images)
      .where(eq(sqliteSchema.images.id, id))
      .limit(1);
    const row = rows[0];
    if (!row?.data) return null;
    return { data: Buffer.from(row.data), mimeType: row.mimeType };
  }
}

/**
 * Cloudinary: flujo directo navegador→Cloudinary con firma del servidor.
 * La imagen no pasa por el backend de Next (ver docs/IMAGES.md).
 * Este storage sirve para casos admin/server-side; el flujo principal del
 * navegador usa /api/images/sign y sube directo a Cloudinary.
 */
class CloudinaryImageStorage implements ImageStorage {
  readonly kind = 'cloudinary' as const;

  constructor(private readonly credentials: CloudinaryCredentials) {}

  async put(input: ImagePutInput): Promise<RemoteImageMetadata> {
    const sqlite = await getSqlite();
    const existing = await sqlite
      .select()
      .from(sqliteSchema.images)
      .where(eq(sqliteSchema.images.id, input.id))
      .limit(1);
    if (existing[0] && existing[0].userId !== input.userId) throw new ImageOwnershipError();
    const { cloudName, apiKey, apiSecret } = this.credentials;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `my-closet/${input.userId}`;
    const signature = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    const form = new FormData();
    form.append('file', `data:${input.mimeType};base64,${input.data.toString('base64')}`);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: form },
    );
    if (!response.ok) {
      throw new Error(`Cloudinary upload falló: HTTP ${response.status}`);
    }
    const result = (await response.json()) as { secure_url: string; public_id?: string };
    const now = new Date().toISOString();
    const storageKey = result.public_id ?? null;
    const values = {
      id: input.id,
      userId: input.userId,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      data: null,
      remoteUrl: result.secure_url,
      storageProvider: this.kind,
      storageKey,
      createdAt: existing[0]?.createdAt ?? now,
      updatedAt: now,
    };
    const written = await sqlite
      .insert(sqliteSchema.images)
      .values(values)
      .onConflictDoUpdate({
        target: sqliteSchema.images.id,
        set: values,
        setWhere: eq(sqliteSchema.images.userId, input.userId),
      })
      .returning({ userId: sqliteSchema.images.userId });
    if (!written[0]) throw new ImageOwnershipError();
    return {
      id: input.id,
      userId: input.userId,
      mimeType: 'image/webp',
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      remoteUrl: result.secure_url,
      storageProvider: this.kind,
      storageKey,
      createdAt: values.createdAt,
      updatedAt: now,
    };
  }

  async get(): Promise<{ data: Buffer; mimeType: string } | null> {
    // Las imágenes viven en el CDN de Cloudinary; no se descargan al servidor.
    return null;
  }
}

export class ImageOwnershipError extends Error {
  constructor() {
    super('El identificador de imagen pertenece a otro usuario');
    this.name = 'ImageOwnershipError';
  }
}

let storage: ImageStorage | null = null;

export function getImageStorage(): ImageStorage {
  if (!storage) {
    const cloudinaryCredentials = getCloudinaryCredentials();
    storage = cloudinaryCredentials
      ? new CloudinaryImageStorage(cloudinaryCredentials)
      : new LocalImageStorage();
  }
  return storage;
}

/** Parámetros de firma para subida directa desde el navegador (Cloudinary). */
export function buildDirectUploadSignature(userId: string, apiKey: string, apiSecret: string): {
  timestamp: number;
  signature: string;
  folder: string;
} {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `my-closet/${userId}`;
  const signature = createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  return { timestamp, signature, folder };
}
