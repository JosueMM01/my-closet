/**
 * Almacén clave-valor local para preferencias y perfil (sin secretos).
 */
import { getDB } from './db';
import type { LocalProfile } from '@/lib/domain/types';
import { localProfileSchema } from '@/lib/domain/validation';
import {
  recommendationContextSchema,
  type RecommendationContext,
} from '@/lib/domain/recommendations';

const PROFILE_KEY = 'local-profile';
const RECOMMENDATION_CONTEXT_PREFIX = 'recommendations:context:';
const DELETED_ACCOUNT_PREFIX = 'account-deleted:';

/** Write only after the server has confirmed deletion. Contains no credentials. */
export async function markAccountDeleted(userId: string): Promise<void> {
  await getDB().kv.put({ key: `${DELETED_ACCOUNT_PREFIX}${userId}`, value: true });
}

/** Runs after a full document reload, so old sync/upload callbacks cannot repopulate the cache. */
export async function purgeDeletedAccount(userId: string): Promise<void> {
  const db = getDB();
  const marker = `${DELETED_ACCOUNT_PREFIX}${userId}`;
  await db.transaction('rw', db.tables, async () => {
    if (!(await db.kv.get(marker))) return;
    const foreignPhotoIds = new Set((await db.garments.toArray())
      .filter(garment => garment.userId !== userId).map(garment => garment.photoId));
    await Promise.all([
      db.garments.where('userId').equals(userId).delete(),
      db.outfits.where('userId').equals(userId).delete(),
      db.calendarEntries.where('userId').equals(userId).delete(),
      db.outbox.where('userId').equals(userId).delete(),
      db.wardrobeShares.filter(share => share.grantorId === userId || share.granteeId === userId).delete(),
      db.images.where('userId').equals(userId).filter(image => !foreignPhotoIds.has(image.id)).delete(),
      db.kv.filter(row => row.key !== marker && row.key.includes(userId)).delete(),
    ]);
    const current = localProfileSchema.safeParse((await db.kv.get(PROFILE_KEY))?.value);
    if (current.success && current.data.userId === userId) {
      await Promise.all([db.kv.delete(PROFILE_KEY), db.adminUsers.clear(), db.adminInvitations.clear()]);
    }
  });
}

function recommendationContextKey(userId: string): string {
  return `${RECOMMENDATION_CONTEXT_PREFIX}${userId}`;
}

export async function getLocalProfile(): Promise<LocalProfile | null> {
  const db = getDB();
  const row = await db.kv.get(PROFILE_KEY);
  if (!row) return null;
  const parsed = localProfileSchema.safeParse(row.value);
  if (!parsed.success) return null;
  const profile = parsed.data;
  if (await db.kv.get(`${DELETED_ACCOUNT_PREFIX}${profile.userId}`)) {
    await purgeDeletedAccount(profile.userId);
    return null;
  }
  // Persiste los defaults añadidos a perfiles creados por versiones anteriores.
  await db.kv.put({ key: PROFILE_KEY, value: profile });
  return profile;
}

export async function setLocalProfile(profile: LocalProfile): Promise<void> {
  const validated = localProfileSchema.parse(profile);
  const db = getDB();
  await db.transaction('rw', [db.kv, db.adminUsers, db.adminInvitations], async () => {
    if (await db.kv.get(`${DELETED_ACCOUNT_PREFIX}${validated.userId}`)) return;
    await db.kv.put({ key: PROFILE_KEY, value: validated });
    if (validated.role !== 'ADMIN') {
      await Promise.all([db.adminUsers.clear(), db.adminInvitations.clear()]);
    }
  });
}

export async function clearLocalProfile(): Promise<void> {
  const db = getDB();
  await db.transaction('rw', [db.kv, db.adminUsers, db.adminInvitations], async () => {
    await Promise.all([
      db.kv.delete(PROFILE_KEY),
      db.adminUsers.clear(),
      db.adminInvitations.clear(),
    ]);
  });
}

export async function getKV<T>(key: string): Promise<T | null> {
  const row = await getDB().kv.get(key);
  return (row?.value as T | undefined) ?? null;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await getDB().kv.put({ key, value });
}

export async function getRecommendationContext(userId: string): Promise<RecommendationContext | null> {
  const row = await getDB().kv.get(recommendationContextKey(userId));
  if (!row) return null;
  const parsed = recommendationContextSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

export async function setRecommendationContext(
  userId: string,
  context: RecommendationContext,
): Promise<void> {
  const value = recommendationContextSchema.parse(context);
  await getDB().kv.put({ key: recommendationContextKey(userId), value });
}

export async function clearRecommendationContext(userId: string): Promise<void> {
  await getDB().kv.delete(recommendationContextKey(userId));
}
