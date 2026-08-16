/**
 * Almacén clave-valor local para preferencias y perfil (sin secretos).
 */
import { getDB } from './db';
import type { LocalProfile } from '@/lib/domain/types';

const PROFILE_KEY = 'local-profile';

export async function getLocalProfile(): Promise<LocalProfile | null> {
  const row = await getDB().kv.get(PROFILE_KEY);
  return (row?.value as LocalProfile | undefined) ?? null;
}

export async function setLocalProfile(profile: LocalProfile): Promise<void> {
  await getDB().kv.put({ key: PROFILE_KEY, value: profile });
}

export async function clearLocalProfile(): Promise<void> {
  await getDB().kv.delete(PROFILE_KEY);
}

export async function getKV<T>(key: string): Promise<T | null> {
  const row = await getDB().kv.get(key);
  return (row?.value as T | undefined) ?? null;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await getDB().kv.put({ key, value });
}
