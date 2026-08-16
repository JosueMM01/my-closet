/**
 * Repositorio de usuarios (SQLite dev; el contrato es idéntico en PG).
 */
import { eq } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { getSqlite, sqliteSchema } from '@/server/db';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const sqlite = await getSqlite();
  const record: UserRecord = {
    id: uuid(),
    email: normalizeEmail(input.email),
    displayName: input.displayName.trim(),
    passwordHash: input.passwordHash,
    createdAt: new Date().toISOString(),
  };
  await sqlite.insert(sqliteSchema.users).values(record);
  return record;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  const rows = await sqlite
    .select()
    .from(sqliteSchema.users)
    .where(eq(sqliteSchema.users.email, normalizeEmail(email)))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        passwordHash: row.passwordHash,
        createdAt: row.createdAt,
      }
    : null;
}

export async function userExists(email: string): Promise<boolean> {
  return (await findUserByEmail(email)) !== null;
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string },
): Promise<void> {
  const sqlite = await getSqlite();
  if (patch.displayName !== undefined) {
    await sqlite
      .update(sqliteSchema.users)
      .set({ displayName: patch.displayName.trim() })
      .where(eq(sqliteSchema.users.id, userId));
  }
}

/** Cambio de contraseña re-verificando la actual. */
export async function changePassword(input: {
  userId: string;
  currentPasswordHashMatch: (password: string) => Promise<boolean>;
  currentPassword: string;
  newPasswordHash: string;
}): Promise<boolean> {
  const sqlite = await getSqlite();
  const rows = await sqlite
    .select({ passwordHash: sqliteSchema.users.passwordHash })
    .from(sqliteSchema.users)
    .where(eq(sqliteSchema.users.id, input.userId))
    .limit(1);
  const stored = rows[0]?.passwordHash;
  if (!stored) return false;
  if (!(await input.currentPasswordHashMatch(input.currentPassword))) return false;
  await sqlite
    .update(sqliteSchema.users)
    .set({ passwordHash: input.newPasswordHash })
    .where(eq(sqliteSchema.users.id, input.userId));
  return true;
}
