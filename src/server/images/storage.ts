/**
 * ImageStorage: abstracción de almacenamiento de imágenes del servidor.
 *  - LocalImageStorage: blobs en SQLite (desarrollo; TODO funciona sin cuenta).
 *  - CloudinaryImageStorage: subida firmada vía REST (activa solo con env).
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
}

export interface ImageStorage {
  readonly kind: 'local' | 'cloudinary';
  put(input: ImagePutInput): Promise<{ url: string }>;
  get(id: string): Promise<{ data: Buffer; mimeType: string } | null>;
}

class LocalImageStorage implements ImageStorage {
  readonly kind = 'local' as const;

  async put(input: ImagePutInput): Promise<{ url: string }> {
    const sqlite = await getSqlite();
    const values = {
      id: input.id,
      userId: input.userId,
      mimeType: input.mimeType,
      byteSize: input.data.byteLength,
      data: input.data,
      remoteUrl: null as string | null,
    };
    await sqlite
      .insert(sqliteSchema.images)
      .values(values)
      .onConflictDoUpdate({ target: sqliteSchema.images.id, set: values });
    return { url: `/api/images/${input.id}` };
  }

  async get(id: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const sqlite = await getSqlite();
    const rows = await sqlite
      .select({ data: sqliteSchema.images.data, mimeType: sqliteSchema.images.mimeType })
      .from(sqliteSchema.images)
      .where(eq(sqliteSchema.images.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
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

  async put(input: ImagePutInput): Promise<{ url: string }> {
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
    const result = (await response.json()) as { secure_url: string };
    return { url: result.secure_url };
  }

  async get(): Promise<{ data: Buffer; mimeType: string } | null> {
    // Las imágenes viven en el CDN de Cloudinary; no se descargan al servidor.
    return null;
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
