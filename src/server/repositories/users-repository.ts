/** Repositorio transaccional de cuentas para SQLite y PostgreSQL. */
import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { UserRole, UserStatus } from '@/lib/domain/types';
import { uuid } from '@/lib/domain/ids';
import { getServerDB, pgSchema, sqliteSchema, type PostgresDB } from '@/server/db';

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

type UserRow =
  | typeof sqliteSchema.users.$inferSelect
  | typeof pgSchema.users.$inferSelect;

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    adminSlot: row.adminSlot,
    profileImageId: row.profileImageId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

interface RegisterAccountInput {
  email: string;
  displayName: string;
  passwordHash: string;
  invitationToken?: string;
  publicRegistrationEnabled: boolean;
}

async function registerPostgres(
  postgres: PostgresDB,
  input: RegisterAccountInput,
  email: string,
  now: string,
): Promise<UserRecord> {
  return postgres.transaction(async (tx) => {
    const duplicate = await tx
      .select({ id: pgSchema.users.id })
      .from(pgSchema.users)
      .where(eq(pgSchema.users.email, email))
      .limit(1);
    if (duplicate[0]) {
      throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
    }

    let role: UserRole = 'USER';
    let invitationId: string | null = null;
    if (input.invitationToken) {
      const invitations = await tx
        .select()
        .from(pgSchema.accountInvitations)
        .where(eq(pgSchema.accountInvitations.tokenHash, hashInvitationToken(input.invitationToken)))
        .limit(1);
      const invitation = invitations[0];
      if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
        throw new AccountError('INVITATION_INVALID', 'La invitación no es válida o ya fue utilizada');
      }
      if (invitation.email !== email) {
        throw new AccountError('INVITATION_EMAIL_MISMATCH', 'La invitación corresponde a otro correo');
      }
      if (invitation.expiresAt <= new Date(now)) {
        throw new AccountError('INVITATION_EXPIRED', 'La invitación ha expirado');
      }
      role = invitation.role;
      invitationId = invitation.id;
    } else if (!input.publicRegistrationEnabled) {
      throw new AccountError(
        'PUBLIC_REGISTRATION_DISABLED',
        'El registro público está deshabilitado; necesitas una invitación',
      );
    }

    const activeAdmins = role === 'ADMIN'
      ? await tx
          .select({ adminSlot: pgSchema.users.adminSlot })
          .from(pgSchema.users)
          .where(and(eq(pgSchema.users.role, 'ADMIN'), eq(pgSchema.users.status, 'ACTIVE')))
          .for('update')
      : [];
    const adminSlot = role === 'ADMIN' ? availableAdminSlot(activeAdmins) : null;
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
    await tx.insert(pgSchema.users).values({ ...record, createdAt: new Date(record.createdAt) });

    if (invitationId) {
      const accepted = await tx
        .update(pgSchema.accountInvitations)
        .set({ acceptedAt: new Date(now), acceptedBy: record.id })
        .where(
          and(
            eq(pgSchema.accountInvitations.id, invitationId),
            isNull(pgSchema.accountInvitations.acceptedAt),
            isNull(pgSchema.accountInvitations.revokedAt),
            gt(pgSchema.accountInvitations.expiresAt, new Date(now)),
          ),
        )
        .returning({ id: pgSchema.accountInvitations.id });
      if (accepted.length !== 1) {
        throw new AccountError('INVITATION_INVALID', 'La invitación no es válida o ya fue utilizada');
      }
    }
    return record;
  });
}

function availableAdminSlot(
  rows: Array<{ adminSlot: number | null }>,
): 1 | 2 {
  const used = new Set(rows.map((row) => row.adminSlot));
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  throw new AccountError('ADMIN_LIMIT', 'Ya existen dos administradores activos');
}

export async function registerAccount(input: RegisterAccountInput): Promise<UserRecord> {
  const db = await getServerDB();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();

  if (db.dialect === 'postgres') {
    return registerPostgres(db.postgres, input, email, now);
  }
  const sqlite = db.sqlite;

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
  const db = await getServerDB();
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
  if (db.dialect === 'postgres') {
    await db.postgres
      .insert(pgSchema.users)
      .values({ ...record, createdAt: new Date(record.createdAt) });
  } else {
    await db.sqlite.insert(sqliteSchema.users).values(record);
  }
  return record;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const db = await getServerDB();
  const normalized = normalizeEmail(email);
  const row = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.users)
        .where(eq(pgSchema.users.email, normalized))
        .limit(1)
        .then((rows) => rows[0])
    : await db.sqlite
        .select()
        .from(sqliteSchema.users)
        .where(eq(sqliteSchema.users.email, normalized))
        .limit(1)
        .then((rows) => rows[0]);
  return row ? toUserRecord(row) : null;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const db = await getServerDB();
  const row = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, userId))
        .limit(1)
        .then((rows) => rows[0])
    : await db.sqlite
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(pgSchema.users)
        .where(and(eq(pgSchema.users.id, userId), eq(pgSchema.users.status, 'ACTIVE')))
        .limit(1)
        .for('update');
      const user = rows[0];
      if (!user) return null;
      if (patch.profileImageId) {
        const ownedImage = await tx
          .select({ id: pgSchema.images.id })
          .from(pgSchema.images)
          .where(
            and(
              eq(pgSchema.images.id, patch.profileImageId),
              eq(pgSchema.images.userId, userId),
            ),
          )
          .limit(1);
        if (!ownedImage[0]) throw new ProfileUpdateError('La imagen no pertenece a esta cuenta');
      }
      const values: { displayName?: string; profileImageId?: string | null } = {};
      if (patch.displayName !== undefined) values.displayName = patch.displayName.trim();
      if (patch.profileImageId !== undefined) values.profileImageId = patch.profileImageId;
      const updated = await tx
        .update(pgSchema.users)
        .set(values)
        .where(eq(pgSchema.users.id, userId))
        .returning();
      return updated[0] ? toUserRecord(updated[0]) : null;
    });
  }
  const sqlite = db.sqlite;
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const result = await db.postgres
      .update(pgSchema.users)
      .set({ passwordHash })
      .where(and(eq(pgSchema.users.id, userId), eq(pgSchema.users.status, 'ACTIVE')))
      .returning({ id: pgSchema.users.id });
    return result.length === 1;
  }
  const result = await db.sqlite
    .update(sqliteSchema.users)
    .set({ passwordHash })
    .where(and(eq(sqliteSchema.users.id, userId), eq(sqliteSchema.users.status, 'ACTIVE')));
  return result.changes === 1;
}

export async function updateEmail(userId: string, email: string): Promise<UserRecord | null> {
  const db = await getServerDB();
  const normalized = normalizeEmail(email);
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const users = await tx
        .select()
        .from(pgSchema.users)
        .where(and(eq(pgSchema.users.id, userId), eq(pgSchema.users.status, 'ACTIVE')))
        .limit(1)
        .for('update');
      const user = users[0];
      if (!user) return null;
      const duplicate = await tx
        .select({ id: pgSchema.users.id })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.email, normalized))
        .limit(1);
      if (duplicate[0] && duplicate[0].id !== userId) {
        throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
      }
      const updated = await tx
        .update(pgSchema.users)
        .set({ email: normalized })
        .where(eq(pgSchema.users.id, userId))
        .returning();
      return updated[0] ? toUserRecord(updated[0]) : null;
    });
  }
  const sqlite = db.sqlite;
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
