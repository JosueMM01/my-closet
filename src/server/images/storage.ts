/**
 * ImageStorage: abstracción de almacenamiento de imágenes del servidor.
 *  - LocalImageStorage: blobs en SQLite (desarrollo; TODO funciona sin cuenta).
 *  - CloudinaryImageStorage: subida firmada vía REST (activa solo con env).
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  cloudinaryResourceSchema,
  type RemoteImageMetadata,
} from '@/lib/domain/validation';
import {
  getCloudinaryCredentials,
  type CloudinaryCredentials,
} from '@/server/env';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';

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

interface PersistedImageInput {
  id: string;
  userId: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  byteSize: number;
  data: Buffer | null;
  remoteUrl: string;
  storageProvider: 'local' | 'cloudinary';
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
}

async function findStoredImage(id: string): Promise<{ userId: string; createdAt: string } | null> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const rows = await db.postgres
      .select({ userId: pgSchema.images.userId, createdAt: pgSchema.images.createdAt })
      .from(pgSchema.images)
      .where(eq(pgSchema.images.id, id))
      .limit(1);
    const row = rows[0];
    return row ? { userId: row.userId, createdAt: row.createdAt.toISOString() } : null;
  }
  const rows = await db.sqlite
    .select({ userId: sqliteSchema.images.userId, createdAt: sqliteSchema.images.createdAt })
    .from(sqliteSchema.images)
    .where(eq(sqliteSchema.images.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function persistImage(input: PersistedImageInput): Promise<void> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const values = {
      ...input,
      data: input.data?.toString('base64') ?? null,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.updatedAt),
    };
    const written = await db.postgres
      .insert(pgSchema.images)
      .values(values)
      .onConflictDoUpdate({
        target: pgSchema.images.id,
        set: values,
        setWhere: eq(pgSchema.images.userId, input.userId),
      })
      .returning({ userId: pgSchema.images.userId });
    if (!written[0]) throw new ImageOwnershipError();
    return;
  }
  const written = await db.sqlite
    .insert(sqliteSchema.images)
    .values(input)
    .onConflictDoUpdate({
      target: sqliteSchema.images.id,
      set: input,
      setWhere: eq(sqliteSchema.images.userId, input.userId),
    })
    .returning({ userId: sqliteSchema.images.userId });
  if (!written[0]) throw new ImageOwnershipError();
}

class LocalImageStorage implements ImageStorage {
  readonly kind = 'local' as const;

  async put(input: ImagePutInput): Promise<RemoteImageMetadata> {
    const existing = await findStoredImage(input.id);
    if (existing && existing.userId !== input.userId) throw new ImageOwnershipError();
    const now = new Date().toISOString();
    const remoteUrl = `/api/images/${input.id}`;
    const values: PersistedImageInput = {
      id: input.id,
      userId: input.userId,
      mimeType: 'image/webp',
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      data: input.data,
      remoteUrl,
      storageProvider: this.kind,
      storageKey: input.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await persistImage(values);
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
    const db = await getServerDB();
    if (db.dialect === 'postgres') {
      const rows = await db.postgres
        .select({ data: pgSchema.images.data, mimeType: pgSchema.images.mimeType })
        .from(pgSchema.images)
        .where(eq(pgSchema.images.id, id))
        .limit(1);
      const row = rows[0];
      if (!row?.data) return null;
      return { data: Buffer.from(row.data, 'base64'), mimeType: row.mimeType };
    }
    const rows = await db.sqlite
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
    const existing = await findStoredImage(input.id);
    if (existing && existing.userId !== input.userId) throw new ImageOwnershipError();
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
    const values: PersistedImageInput = {
      id: input.id,
      userId: input.userId,
      mimeType: 'image/webp',
      width: input.width,
      height: input.height,
      byteSize: input.data.byteLength,
      data: null,
      remoteUrl: result.secure_url,
      storageProvider: this.kind,
      storageKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await persistImage(values);
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
export function buildDirectUploadSignature(
  userId: string,
  imageId: string,
  apiSecret: string,
): {
  timestamp: number;
  signature: string;
  folder: string;
  publicId: string;
} {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `my-closet/${userId}`;
  const publicId = imageId;
  const signature = createHash('sha1')
    .update(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  return { timestamp, signature, folder, publicId };
}

export async function finalizeDirectCloudinaryUpload(
  userId: string,
  imageId: string,
): Promise<RemoteImageMetadata> {
  const credentials = getCloudinaryCredentials();
  if (!credentials) throw new Error('Cloudinary no está configurado');
  const expectedPublicId = `my-closet/${userId}/${imageId}`;
  const auth = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}`
      + `/resources/image/upload/${encodeURIComponent(expectedPublicId)}`,
    { headers: { authorization: `Basic ${auth}` }, cache: 'no-store' },
  );
  if (!response.ok) {
    throw new Error(`No se pudo verificar la imagen en Cloudinary: HTTP ${response.status}`);
  }
  const resource = cloudinaryResourceSchema.parse(await response.json());
  if (resource.public_id !== expectedPublicId) {
    throw new ImageOwnershipError();
  }

  const existing = await findStoredImage(imageId);
  if (existing && existing.userId !== userId) throw new ImageOwnershipError();
  const now = new Date().toISOString();
  const values: PersistedImageInput = {
    id: imageId,
    userId,
    mimeType: 'image/webp',
    width: resource.width,
    height: resource.height,
    byteSize: resource.bytes,
    data: null,
    remoteUrl: resource.secure_url,
    storageProvider: 'cloudinary',
    storageKey: resource.public_id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await persistImage(values);
  return values;
}
