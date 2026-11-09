import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { remoteImageMetadataSchema, type RemoteImageMetadata } from '@/lib/domain/validation';
import { getServerDB, pgSchema, sqliteSchema, type ServerDB } from '@/server/db';

export const CLOUDINARY_SIGNATURE_TTL_MS = 60 * 60_000;
export const CLOUDINARY_UPLOAD_RECONCILE_MARGIN_MS = 30 * 60_000;
export const CLOUDINARY_UPLOAD_RECHECK_MS = 24 * 60 * 60_000;

export class CloudinaryUploadAuthorizationError extends Error {
  constructor(public readonly status: 401 | 403 | 409, message: string) {
    super(message);
    this.name = 'CloudinaryUploadAuthorizationError';
  }
}

export interface CloudinaryUploadAuthorization {
  id: string;
  userId: string;
  sessionId: string;
  imageId: string;
  publicId: string;
  folder: string;
  signedAt: number;
  expiresAt: string;
  state: 'AUTHORIZED' | 'FINALIZED' | 'REVOKED' | 'RECONCILE';
}

/** Persist before returning any signature. The public ID is unique per authorization. */
export async function authorizeCloudinaryUpload(input: {
  userId: string;
  sessionId: string;
  imageId: string;
  folder: string;
  now?: number;
  database?: ServerDB;
}): Promise<CloudinaryUploadAuthorization> {
  const db = input.database ?? await getServerDB();
  const now = input.now ?? Date.now();
  const signedAt = Math.floor(now / 1000);
  const expiresAt = new Date((signedAt * 1000) + CLOUDINARY_SIGNATURE_TTL_MS).toISOString();
  const authorization = {
    id: randomUUID(), userId: input.userId, sessionId: input.sessionId, imageId: input.imageId,
    publicId: randomUUID(), folder: input.folder, signedAt, expiresAt,
    state: 'AUTHORIZED' as const, nextCheckAt: expiresAt, createdAt: new Date(now).toISOString(),
  };

  if (db.dialect === 'postgres') {
    await db.postgres.transaction(async (tx) => {
      const actor = await tx.select({ id: pgSchema.users.id, status: pgSchema.users.status })
        .from(pgSchema.users).where(eq(pgSchema.users.id, input.userId)).for('update').limit(1);
      if (actor[0]?.status !== 'ACTIVE') throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const deleted = await tx.select({ userId: pgSchema.accountDeletions.userId })
        .from(pgSchema.accountDeletions).where(eq(pgSchema.accountDeletions.userId, input.userId)).limit(1);
      if (deleted[0]) throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const [session] = await tx.select({ id: pgSchema.sessions.id }).from(pgSchema.sessions)
        .where(and(eq(pgSchema.sessions.id, input.sessionId), eq(pgSchema.sessions.userId, input.userId),
          gt(pgSchema.sessions.expiresAt, new Date()))).for('update').limit(1);
      if (!session) throw new CloudinaryUploadAuthorizationError(401, 'La sesión ya no está vigente');
      const image = await tx.select({ userId: pgSchema.images.userId }).from(pgSchema.images)
        .where(eq(pgSchema.images.id, input.imageId)).for('update').limit(1);
      if (image[0] && image[0].userId !== input.userId) throw new CloudinaryUploadAuthorizationError(409, 'El identificador de imagen ya está en uso');
      await tx.update(pgSchema.cloudinaryUploadAuthorizations).set({ state: 'REVOKED' })
        .where(and(eq(pgSchema.cloudinaryUploadAuthorizations.userId, input.userId),
          eq(pgSchema.cloudinaryUploadAuthorizations.imageId, input.imageId),
          inArray(pgSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'FINALIZED'])));
      await tx.insert(pgSchema.cloudinaryUploadAuthorizations).values(authorization);
    });
  } else {
    db.sqlite.transaction((tx) => {
      const actor = tx.select({ id: sqliteSchema.users.id, status: sqliteSchema.users.status })
        .from(sqliteSchema.users).where(eq(sqliteSchema.users.id, input.userId)).get();
      if (actor?.status !== 'ACTIVE') throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const deleted = tx.select({ userId: sqliteSchema.accountDeletions.userId })
        .from(sqliteSchema.accountDeletions).where(eq(sqliteSchema.accountDeletions.userId, input.userId)).get();
      if (deleted) throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const session = tx.select({ id: sqliteSchema.sessions.id }).from(sqliteSchema.sessions)
        .where(and(eq(sqliteSchema.sessions.id, input.sessionId), eq(sqliteSchema.sessions.userId, input.userId),
          gt(sqliteSchema.sessions.expiresAt, new Date().toISOString()))).get();
      if (!session) throw new CloudinaryUploadAuthorizationError(401, 'La sesión ya no está vigente');
      const image = tx.select({ userId: sqliteSchema.images.userId }).from(sqliteSchema.images)
        .where(eq(sqliteSchema.images.id, input.imageId)).get();
      if (image && image.userId !== input.userId) throw new CloudinaryUploadAuthorizationError(409, 'El identificador de imagen ya está en uso');
      tx.update(sqliteSchema.cloudinaryUploadAuthorizations).set({ state: 'REVOKED' })
        .where(and(eq(sqliteSchema.cloudinaryUploadAuthorizations.userId, input.userId),
          eq(sqliteSchema.cloudinaryUploadAuthorizations.imageId, input.imageId),
          inArray(sqliteSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'FINALIZED'])))
        .run();
      tx.insert(sqliteSchema.cloudinaryUploadAuthorizations).values(authorization).run();
    }, { behavior: 'immediate' });
  }
  return authorization;
}

export async function findCloudinaryUploadAuthorization(id: string, database?: ServerDB): Promise<CloudinaryUploadAuthorization | null> {
  const db = database ?? await getServerDB();
  if (db.dialect === 'postgres') {
    const [row] = await db.postgres.select().from(pgSchema.cloudinaryUploadAuthorizations)
      .where(eq(pgSchema.cloudinaryUploadAuthorizations.id, id)).limit(1);
    return row ?? null;
  }
  return db.sqlite.select().from(sqliteSchema.cloudinaryUploadAuthorizations)
    .where(eq(sqliteSchema.cloudinaryUploadAuthorizations.id, id)).get() ?? null;
}

/** IDs remain in the database as tombstones so revoked uploads can be reconciled repeatedly. */
export async function dueCloudinaryUploadAuthorizations(limit = 10, database?: ServerDB): Promise<CloudinaryUploadAuthorization[]> {
  const db = database ?? await getServerDB();
  const now = new Date(Date.now() - CLOUDINARY_UPLOAD_RECONCILE_MARGIN_MS).toISOString();
  const take = Math.min(Math.max(limit, 1), 25);
  if (db.dialect === 'postgres') {
    return db.postgres.select().from(pgSchema.cloudinaryUploadAuthorizations)
      .where(and(inArray(pgSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'REVOKED', 'RECONCILE']),
        lte(pgSchema.cloudinaryUploadAuthorizations.expiresAt, now), lte(pgSchema.cloudinaryUploadAuthorizations.nextCheckAt, new Date().toISOString())))
      .orderBy(asc(pgSchema.cloudinaryUploadAuthorizations.nextCheckAt)).limit(take);
  }
  return db.sqlite.select().from(sqliteSchema.cloudinaryUploadAuthorizations)
    .where(and(inArray(sqliteSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'REVOKED', 'RECONCILE']),
      lte(sqliteSchema.cloudinaryUploadAuthorizations.expiresAt, now), lte(sqliteSchema.cloudinaryUploadAuthorizations.nextCheckAt, new Date().toISOString())))
    .orderBy(asc(sqliteSchema.cloudinaryUploadAuthorizations.nextCheckAt)).limit(take).all();
}

/** Atomically lease one expired authorization; never call the provider within its signed window. */
export async function claimCloudinaryUploadReconciliation(id: string, database?: ServerDB): Promise<CloudinaryUploadAuthorization | null> {
  const db = database ?? await getServerDB();
  const now = new Date().toISOString();
  const minExpiry = new Date(Date.now() - CLOUDINARY_UPLOAD_RECONCILE_MARGIN_MS).toISOString();
  const nextCheckAt = new Date(Date.now() + 10 * 60_000).toISOString();
  if (db.dialect === 'postgres') {
    const [row] = await db.postgres.update(pgSchema.cloudinaryUploadAuthorizations)
      .set({ state: 'RECONCILE', nextCheckAt })
      .where(and(eq(pgSchema.cloudinaryUploadAuthorizations.id, id),
        inArray(pgSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'REVOKED', 'RECONCILE']),
        lte(pgSchema.cloudinaryUploadAuthorizations.expiresAt, minExpiry),
        lte(pgSchema.cloudinaryUploadAuthorizations.nextCheckAt, now)))
      .returning();
    return row ?? null;
  }
  return db.sqlite.transaction((tx) => {
    const [row] = tx.update(sqliteSchema.cloudinaryUploadAuthorizations)
      .set({ state: 'RECONCILE', nextCheckAt })
      .where(and(eq(sqliteSchema.cloudinaryUploadAuthorizations.id, id),
        inArray(sqliteSchema.cloudinaryUploadAuthorizations.state, ['AUTHORIZED', 'REVOKED', 'RECONCILE']),
        lte(sqliteSchema.cloudinaryUploadAuthorizations.expiresAt, minExpiry),
        lte(sqliteSchema.cloudinaryUploadAuthorizations.nextCheckAt, now)))
      .returning().all();
    return row ?? null;
  }, { behavior: 'immediate' });
}

export async function hasPendingCloudinaryDeletion(storageKey: string, database?: ServerDB): Promise<boolean> {
  const db = database ?? await getServerDB();
  const conditions = (schema: typeof sqliteSchema | typeof pgSchema) => and(
    eq(schema.imageDeletionJobs.storageProvider, 'cloudinary'),
    eq(schema.imageDeletionJobs.storageKey, storageKey),
    inArray(schema.imageDeletionJobs.state, ['PENDING', 'PROCESSING', 'SHARED']),
  );
  if (db.dialect === 'postgres') return !!(await db.postgres.select({ id: pgSchema.imageDeletionJobs.imageId })
    .from(pgSchema.imageDeletionJobs).where(conditions(pgSchema)).limit(1))[0];
  return !!db.sqlite.select({ id: sqliteSchema.imageDeletionJobs.imageId }).from(sqliteSchema.imageDeletionJobs)
    .where(conditions(sqliteSchema)).limit(1).get();
}

/** Synthetic image IDs let the existing worker safely delete superseded physical assets. */
export async function enqueueCloudinaryAuthorizationDeletion(input: {
  storageKey: string; remoteUrl: string | null; database?: ServerDB;
}): Promise<void> {
  const db = input.database ?? await getServerDB();
  const now = new Date().toISOString();
  const values = { imageId: `upload:${randomUUID()}`, storageProvider: 'cloudinary' as const,
    storageKey: input.storageKey, remoteUrl: input.remoteUrl, state: 'PENDING' as const,
    attempts: 0, nextAttemptAt: now, createdAt: now };
  if (db.dialect === 'postgres') await db.postgres.insert(pgSchema.imageDeletionJobs).values(values);
  else db.sqlite.insert(sqliteSchema.imageDeletionJobs).values(values).run();
}

export async function scheduleCloudinaryUploadRecheck(id: string, database?: ServerDB): Promise<void> {
  const db = database ?? await getServerDB();
  const nextCheckAt = new Date(Date.now() + CLOUDINARY_UPLOAD_RECHECK_MS).toISOString();
  if (db.dialect === 'postgres') {
    await db.postgres.update(pgSchema.cloudinaryUploadAuthorizations).set({ state: 'RECONCILE', nextCheckAt })
      .where(and(eq(pgSchema.cloudinaryUploadAuthorizations.id, id), inArray(pgSchema.cloudinaryUploadAuthorizations.state, ['REVOKED', 'RECONCILE'])));
  } else {
    db.sqlite.update(sqliteSchema.cloudinaryUploadAuthorizations).set({ state: 'RECONCILE', nextCheckAt })
      .where(and(eq(sqliteSchema.cloudinaryUploadAuthorizations.id, id), inArray(sqliteSchema.cloudinaryUploadAuthorizations.state, ['REVOKED', 'RECONCILE']))).run();
  }
}

/** Persist verified provider metadata only while the same account is still active. */
export async function finalizeCloudinaryUpload(input: {
  authorizationId: string;
  userId: string;
  sessionId: string;
  imageId: string;
  expectedPublicId: string;
  remoteUrl: string;
  width: number;
  height: number;
  byteSize: number;
  database?: ServerDB;
}): Promise<RemoteImageMetadata> {
  const db = input.database ?? await getServerDB();
  const now = new Date().toISOString();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const [actor] = await tx.select({ id: pgSchema.users.id, status: pgSchema.users.status })
        .from(pgSchema.users).where(eq(pgSchema.users.id, input.userId)).for('update').limit(1);
      if (actor?.status !== 'ACTIVE') throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const deleted = await tx.select({ userId: pgSchema.accountDeletions.userId }).from(pgSchema.accountDeletions)
        .where(eq(pgSchema.accountDeletions.userId, input.userId)).limit(1);
      if (deleted[0]) throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
      const [session] = await tx.select({ id: pgSchema.sessions.id }).from(pgSchema.sessions)
        .where(and(eq(pgSchema.sessions.id, input.sessionId), eq(pgSchema.sessions.userId, input.userId),
          gt(pgSchema.sessions.expiresAt, new Date()))).for('update').limit(1);
      if (!session) throw new CloudinaryUploadAuthorizationError(401, 'La sesión ya no está vigente');
      const [authorization] = await tx.select().from(pgSchema.cloudinaryUploadAuthorizations)
        .where(eq(pgSchema.cloudinaryUploadAuthorizations.id, input.authorizationId)).for('update').limit(1);
      if (!authorization || authorization.userId !== input.userId || authorization.imageId !== input.imageId
        || authorization.sessionId !== input.sessionId
        || `${authorization.folder}/${authorization.publicId}` !== input.expectedPublicId) {
        throw new CloudinaryUploadAuthorizationError(409, 'La autorización de subida venció o ya no está vigente');
      }
      const [existing] = await tx.select().from(pgSchema.images).where(eq(pgSchema.images.id, input.imageId)).for('update').limit(1);
      if (existing && existing.userId !== input.userId) throw new CloudinaryUploadAuthorizationError(409, 'El identificador de imagen ya está en uso');
      if (authorization.state === 'FINALIZED' && existing?.storageKey === input.expectedPublicId) {
        return remoteImageMetadataSchema.parse({ id: existing.id, userId: existing.userId, mimeType: existing.mimeType, width: existing.width ?? 0,
          height: existing.height ?? 0, byteSize: existing.byteSize, remoteUrl: existing.remoteUrl ?? input.remoteUrl,
          storageProvider: 'cloudinary' as const, storageKey: existing.storageKey, createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString() });
      }
      if (authorization.state !== 'AUTHORIZED' || Date.now() > authorization.signedAt * 1000 + CLOUDINARY_SIGNATURE_TTL_MS) {
        throw new CloudinaryUploadAuthorizationError(409, 'La autorización de subida venció o ya no está vigente');
      }
      const values = {
        id: input.imageId, userId: input.userId, mimeType: 'image/webp' as const,
        width: input.width, height: input.height, byteSize: input.byteSize, data: null,
        remoteUrl: input.remoteUrl, storageProvider: 'cloudinary' as const,
        storageKey: input.expectedPublicId, createdAt: existing?.createdAt ?? new Date(now), updatedAt: new Date(now),
      };
      const [written] = await tx.insert(pgSchema.images).values(values).onConflictDoUpdate({
        target: pgSchema.images.id, set: values, setWhere: eq(pgSchema.images.userId, input.userId),
      }).returning();
      if (!written) throw new CloudinaryUploadAuthorizationError(409, 'El identificador de imagen ya está en uso');
      await tx.update(pgSchema.cloudinaryUploadAuthorizations).set({ state: 'FINALIZED' })
        .where(eq(pgSchema.cloudinaryUploadAuthorizations.id, authorization.id));
      return remoteImageMetadataSchema.parse({ id: values.id, userId: values.userId, mimeType: values.mimeType,
        width: values.width, height: values.height, byteSize: values.byteSize, remoteUrl: values.remoteUrl,
        storageProvider: values.storageProvider, storageKey: values.storageKey,
        createdAt: (written.createdAt instanceof Date ? written.createdAt : new Date(written.createdAt)).toISOString(), updatedAt: now });
    });
  }

  return db.sqlite.transaction((tx) => {
    const actor = tx.select({ id: sqliteSchema.users.id, status: sqliteSchema.users.status }).from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.id, input.userId)).get();
    if (actor?.status !== 'ACTIVE') throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
    const deleted = tx.select({ userId: sqliteSchema.accountDeletions.userId }).from(sqliteSchema.accountDeletions)
      .where(eq(sqliteSchema.accountDeletions.userId, input.userId)).get();
    if (deleted) throw new CloudinaryUploadAuthorizationError(401, 'La cuenta ya no está activa');
    const session = tx.select({ id: sqliteSchema.sessions.id }).from(sqliteSchema.sessions)
      .where(and(eq(sqliteSchema.sessions.id, input.sessionId), eq(sqliteSchema.sessions.userId, input.userId),
        gt(sqliteSchema.sessions.expiresAt, new Date().toISOString()))).get();
    if (!session) throw new CloudinaryUploadAuthorizationError(401, 'La sesión ya no está vigente');
    const authorization = tx.select().from(sqliteSchema.cloudinaryUploadAuthorizations)
      .where(eq(sqliteSchema.cloudinaryUploadAuthorizations.id, input.authorizationId)).get();
    if (!authorization || authorization.userId !== input.userId || authorization.imageId !== input.imageId
      || authorization.sessionId !== input.sessionId
      || `${authorization.folder}/${authorization.publicId}` !== input.expectedPublicId) {
      throw new CloudinaryUploadAuthorizationError(409, 'La autorización de subida venció o ya no está vigente');
    }
    const existing = tx.select().from(sqliteSchema.images).where(eq(sqliteSchema.images.id, input.imageId)).get();
    if (existing && existing.userId !== input.userId) throw new CloudinaryUploadAuthorizationError(409, 'El identificador de imagen ya está en uso');
    if (authorization.state === 'FINALIZED' && existing?.storageKey === input.expectedPublicId) {
      return remoteImageMetadataSchema.parse({ id: existing.id, userId: existing.userId, mimeType: existing.mimeType, width: existing.width ?? 0,
        height: existing.height ?? 0, byteSize: existing.byteSize, remoteUrl: existing.remoteUrl ?? input.remoteUrl,
        storageProvider: 'cloudinary' as const, storageKey: existing.storageKey, createdAt: existing.createdAt,
        updatedAt: existing.updatedAt });
    }
    if (authorization.state !== 'AUTHORIZED' || Date.now() > authorization.signedAt * 1000 + CLOUDINARY_SIGNATURE_TTL_MS) {
      throw new CloudinaryUploadAuthorizationError(409, 'La autorización de subida venció o ya no está vigente');
    }
    const values = {
      id: input.imageId, userId: input.userId, mimeType: 'image/webp' as const,
      width: input.width, height: input.height, byteSize: input.byteSize, data: null,
      remoteUrl: input.remoteUrl, storageProvider: 'cloudinary' as const,
      storageKey: input.expectedPublicId, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    tx.insert(sqliteSchema.images).values(values).onConflictDoUpdate({
      target: sqliteSchema.images.id, set: values, setWhere: eq(sqliteSchema.images.userId, input.userId),
    }).run();
    tx.update(sqliteSchema.cloudinaryUploadAuthorizations).set({ state: 'FINALIZED' })
      .where(eq(sqliteSchema.cloudinaryUploadAuthorizations.id, authorization.id)).run();
    return remoteImageMetadataSchema.parse({ id: values.id, userId: values.userId, mimeType: values.mimeType,
      width: values.width, height: values.height, byteSize: values.byteSize, remoteUrl: values.remoteUrl,
      storageProvider: values.storageProvider, storageKey: values.storageKey,
      createdAt: values.createdAt, updatedAt: values.updatedAt });
  }, { behavior: 'immediate' });
}
