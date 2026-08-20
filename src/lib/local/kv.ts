/**
 * Almacén clave-valor local para preferencias y perfil (sin secretos).
 */
import { getDB } from './db';
import type { LocalProfile } from '@/lib/domain/types';
import { localProfileSchema } from '@/lib/domain/validation';

const PROFILE_KEY = 'local-profile';

export async function getLocalProfile(): Promise<LocalProfile | null> {
  const db = getDB();
  const row = await db.kv.get(PROFILE_KEY);
  if (!row) return null;
  const parsed = localProfileSchema.safeParse(row.value);
  if (!parsed.success) return null;
  const profile = parsed.data;
  // Persiste los defaults añadidos a perfiles creados por versiones anteriores.
  await db.kv.put({ key: PROFILE_KEY, value: profile });
  return profile;
}

export async function setLocalProfile(profile: LocalProfile): Promise<void> {
  const validated = localProfileSchema.parse(profile);
  const db = getDB();
  await db.transaction('rw', [db.kv, db.adminUsers, db.adminInvitations], async () => {
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
