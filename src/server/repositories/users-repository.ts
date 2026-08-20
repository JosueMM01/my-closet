/** Repositorio transaccional de cuentas para SQLite local. */
import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { UserRole, UserStatus } from '@/lib/domain/types';
import { uuid } from '@/lib/domain/ids';
import { getSqlite, sqliteSchema } from '@/server/db';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  adminSlot: number | null;
  profileImageId: string | null;
  createdAt: string;
}

export type AccountErrorCode =
  | 'EMAIL_EXISTS'
  | 'INVITATION_INVALID'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'INVITATION_EXPIRED'
  | 'PUBLIC_REGISTRATION_DISABLED'
  | 'ADMIN_LIMIT';

export class AccountError extends Error {
  constructor(
    public readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export class ProfileUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileUpdateError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUserRecord(row: typeof sqliteSchema.users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    adminSlot: row.adminSlot,
    profileImageId: row.profileImageId,
    createdAt: row.createdAt,
  };
}

function availableAdminSlot(
  rows: Array<{ adminSlot: number | null }>,
): 1 | 2 {
  const used = new Set(rows.map((row) => row.adminSlot));
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  throw new AccountError('ADMIN_LIMIT', 'Ya existen dos administradores activos');
}

export async function registerAccount(input: {
  email: string;
  displayName: string;
  passwordHash: string;
  invitationToken?: string;
  publicRegistrationEnabled: boolean;
  bootstrapAdminEnabled: boolean;
}): Promise<UserRecord> {
  const sqlite = await getSqlite();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();

  return sqlite.transaction((tx) => {
    const duplicate = tx
      .select({ id: sqliteSchema.users.id })
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.email, email))
      .get();
    if (duplicate) {
      throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
    }

    let role: UserRole = 'USER';
    let invitationId: string | null = null;
    if (input.invitationToken) {
      const invitation = tx
        .select()
        .from(sqliteSchema.accountInvitations)
        .where(eq(sqliteSchema.accountInvitations.tokenHash, hashInvitationToken(input.invitationToken)))
        .get();
      if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
        throw new AccountError('INVITATION_INVALID', 'La invitación no es válida o ya fue utilizada');
      }
      if (invitation.email !== email) {
        throw new AccountError(
          'INVITATION_EMAIL_MISMATCH',
          'La invitación corresponde a otro correo',
        );
      }
      if (invitation.expiresAt <= now) {
        throw new AccountError('INVITATION_EXPIRED', 'La invitación ha expirado');
      }
      role = invitation.role;
      invitationId = invitation.id;
    } else {
      if (!input.publicRegistrationEnabled) {
        // En producción invite-only no existe una ruta alternativa de registro abierto.
        throw new AccountError(
          'PUBLIC_REGISTRATION_DISABLED',
          'El registro público está deshabilitado; necesitas una invitación',
        );
      }
      const userCount = tx
        .select({ value: sql<number>`count(*)` })
        .from(sqliteSchema.users)
        .get()?.value ?? 0;
      if (userCount === 0 && input.bootstrapAdminEnabled) role = 'ADMIN';
    }

    const adminSlot = role === 'ADMIN'
      ? availableAdminSlot(
          tx
            .select({ adminSlot: sqliteSchema.users.adminSlot })
            .from(sqliteSchema.users)
            .where(
              and(
                eq(sqliteSchema.users.role, 'ADMIN'),
                eq(sqliteSchema.users.status, 'ACTIVE'),
              ),
            )
            .all(),
        )
      : null;
    const record: UserRecord = {
      id: uuid(),
      email,
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
      role,
      status: 'ACTIVE',
      adminSlot,
      profileImageId: null,
      createdAt: now,
    };
    tx.insert(sqliteSchema.users).values(record).run();

    if (invitationId) {
      const accepted = tx
        .update(sqliteSchema.accountInvitations)
        .set({ acceptedAt: now, acceptedBy: record.id })
        .where(
          and(
            eq(sqliteSchema.accountInvitations.id, invitationId),
            isNull(sqliteSchema.accountInvitations.acceptedAt),
            isNull(sqliteSchema.accountInvitations.revokedAt),
            gt(sqliteSchema.accountInvitations.expiresAt, now),
          ),
        )
        .run();
      if (accepted.changes !== 1) {
        throw new AccountError('INVITATION_INVALID', 'La invitación no es válida o ya fue utilizada');
      }
    }
    return record;
  });
}

/** Creación interna conservada para fixtures y servicios no interactivos. */
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
    role: 'USER',
    status: 'ACTIVE',
    adminSlot: null,
    profileImageId: null,
    createdAt: new Date().toISOString(),
  };
  await sqlite.insert(sqliteSchema.users).values(record);
  return record;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  const row = await sqlite
    .select()
    .from(sqliteSchema.users)
    .where(eq(sqliteSchema.users.email, normalizeEmail(email)))
    .limit(1)
    .then((rows) => rows[0]);
  return row ? toUserRecord(row) : null;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  const row = await sqlite
    .select()
    .from(sqliteSchema.users)
    .where(eq(sqliteSchema.users.id, userId))
    .limit(1)
    .then((rows) => rows[0]);
  return row ? toUserRecord(row) : null;
}

export async function userExists(email: string): Promise<boolean> {
  return (await findUserByEmail(email)) !== null;
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; profileImageId?: string | null },
): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  return sqlite.transaction((tx) => {
    const user = tx
      .select()
      .from(sqliteSchema.users)
      .where(and(eq(sqliteSchema.users.id, userId), eq(sqliteSchema.users.status, 'ACTIVE')))
      .get();
    if (!user) return null;
    if (patch.profileImageId) {
      const ownedImage = tx
        .select({ id: sqliteSchema.images.id })
        .from(sqliteSchema.images)
        .where(
          and(
            eq(sqliteSchema.images.id, patch.profileImageId),
            eq(sqliteSchema.images.userId, userId),
          ),
        )
        .get();
      if (!ownedImage) {
        throw new ProfileUpdateError('La imagen no pertenece a esta cuenta');
      }
    }
    const values: { displayName?: string; profileImageId?: string | null } = {};
    if (patch.displayName !== undefined) values.displayName = patch.displayName.trim();
    if (patch.profileImageId !== undefined) values.profileImageId = patch.profileImageId;
    tx.update(sqliteSchema.users).set(values).where(eq(sqliteSchema.users.id, userId)).run();
    return toUserRecord({ ...user, ...values });
  });
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
  const sqlite = await getSqlite();
  const result = await sqlite
    .update(sqliteSchema.users)
    .set({ passwordHash })
    .where(and(eq(sqliteSchema.users.id, userId), eq(sqliteSchema.users.status, 'ACTIVE')));
  return result.changes === 1;
}

export async function updateEmail(userId: string, email: string): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  const normalized = normalizeEmail(email);
  return sqlite.transaction((tx) => {
    const user = tx
      .select()
      .from(sqliteSchema.users)
      .where(and(eq(sqliteSchema.users.id, userId), eq(sqliteSchema.users.status, 'ACTIVE')))
      .get();
    if (!user) return null;
    const duplicate = tx
      .select({ id: sqliteSchema.users.id })
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.email, normalized))
      .get();
    if (duplicate && duplicate.id !== userId) {
      throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
    }
    tx.update(sqliteSchema.users)
      .set({ email: normalized })
      .where(eq(sqliteSchema.users.id, userId))
      .run();
    return toUserRecord({ ...user, email: normalized });
  });
}
