import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { UserRole } from '@/lib/domain/types';
import { uuid } from '@/lib/domain/ids';
import { getServerDB, getSqlite, pgSchema, sqliteSchema } from '@/server/db';
import { hashInvitationToken, normalizeEmail } from './users-repository';

export interface InvitationRecord {
  id: string;
  email: string;
  role: UserRole;
  createdBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  acceptedBy: string | null;
  createdAt: string;
}

export class AdminAuthorizationError extends Error {
  constructor(message = 'No tienes permisos de administrador') {
    super(message);
    this.name = 'AdminAuthorizationError';
  }
}

export class InvitationOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationOperationError';
  }
}

export async function inspectInvitationToken(token: string): Promise<InvitationRecord> {
  const db = await getServerDB();
  const tokenHash = hashInvitationToken(token);
  const row = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.accountInvitations)
        .where(eq(pgSchema.accountInvitations.tokenHash, tokenHash))
        .limit(1)
        .then((rows) => rows[0])
    : await db.sqlite
        .select()
        .from(sqliteSchema.accountInvitations)
        .where(eq(sqliteSchema.accountInvitations.tokenHash, tokenHash))
        .limit(1)
        .then((rows) => rows[0]);
  if (!row || row.acceptedAt || row.revokedAt) {
    throw new InvitationOperationError('La invitación no es válida o ya fue utilizada');
  }
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (expiresAt.getTime() <= Date.now()) {
    throw new InvitationOperationError('La invitación ha expirado');
  }
  return publicInvitation(row);
}

function assertActiveAdmin(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof getSqlite>>['transaction']>[0]>[0],
  actorId: string,
): void {
  const actor = tx
    .select({ role: sqliteSchema.users.role, status: sqliteSchema.users.status })
    .from(sqliteSchema.users)
    .where(eq(sqliteSchema.users.id, actorId))
    .get();
  if (actor?.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
    throw new AdminAuthorizationError();
  }
}

function publicInvitation(
  row:
    | typeof sqliteSchema.accountInvitations.$inferSelect
    | typeof pgSchema.accountInvitations.$inferSelect,
): InvitationRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    acceptedAt: row.acceptedAt instanceof Date ? row.acceptedAt.toISOString() : row.acceptedAt,
    revokedAt: row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt,
    acceptedBy: row.acceptedBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export async function createInvitation(input: {
  actorId: string;
  email: string;
  role: UserRole;
  expiresAt: string;
}): Promise<{ invitation: InvitationRecord; token: string }> {
  if (input.expiresAt <= new Date().toISOString()) {
    throw new InvitationOperationError('La expiración debe estar en el futuro');
  }
  const db = await getServerDB();
  const token = randomBytes(32).toString('base64url');
  const invitation: InvitationRecord = {
    id: uuid(),
    email: normalizeEmail(input.email),
    role: input.role,
    createdBy: input.actorId,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    revokedAt: null,
    acceptedBy: null,
    createdAt: new Date().toISOString(),
  };
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actors = await tx
        .select({ role: pgSchema.users.role, status: pgSchema.users.status })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, input.actorId))
        .limit(1);
      const actor = actors[0];
      if (actor?.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
        throw new AdminAuthorizationError();
      }
      if (input.role === 'ADMIN') {
        const activeAdmins = await tx
          .select({ id: pgSchema.users.id })
          .from(pgSchema.users)
          .where(and(eq(pgSchema.users.role, 'ADMIN'), eq(pgSchema.users.status, 'ACTIVE')))
          .limit(2);
        if (activeAdmins.length >= 2) {
          throw new InvitationOperationError('Ya existen dos administradores activos; no se pueden crear más invitaciones de administrador');
        }
      }
      await tx.insert(pgSchema.accountInvitations).values({
        ...invitation,
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(invitation.expiresAt),
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date(invitation.createdAt),
      });
      return { invitation, token };
    });
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    assertActiveAdmin(tx, input.actorId);
    if (input.role === 'ADMIN') {
      const activeAdmins = tx
        .select({ id: sqliteSchema.users.id })
        .from(sqliteSchema.users)
        .where(and(eq(sqliteSchema.users.role, 'ADMIN'), eq(sqliteSchema.users.status, 'ACTIVE')))
        .limit(2)
        .all();
      if (activeAdmins.length >= 2) {
        throw new InvitationOperationError('Ya existen dos administradores activos; no se pueden crear más invitaciones de administrador');
      }
    }
    tx.insert(sqliteSchema.accountInvitations)
      .values({ ...invitation, tokenHash: hashInvitationToken(token) })
      .run();
    return { invitation, token };
  });
}

export async function listInvitations(actorId: string): Promise<InvitationRecord[]> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actors = await tx
        .select({ role: pgSchema.users.role, status: pgSchema.users.status })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, actorId))
        .limit(1);
      const actor = actors[0];
      if (actor?.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
        throw new AdminAuthorizationError();
      }
      return (await tx
        .select()
        .from(pgSchema.accountInvitations)
        .orderBy(desc(pgSchema.accountInvitations.createdAt)))
        .map(publicInvitation);
    });
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    assertActiveAdmin(tx, actorId);
    return tx
      .select()
      .from(sqliteSchema.accountInvitations)
      .orderBy(desc(sqliteSchema.accountInvitations.createdAt))
      .all()
      .map(publicInvitation);
  });
}

export async function revokeInvitation(actorId: string, invitationId: string): Promise<InvitationRecord> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actors = await tx
        .select({ role: pgSchema.users.role, status: pgSchema.users.status })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, actorId))
        .limit(1);
      const actor = actors[0];
      if (actor?.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
        throw new AdminAuthorizationError();
      }
      const invitations = await tx
        .select()
        .from(pgSchema.accountInvitations)
        .where(eq(pgSchema.accountInvitations.id, invitationId))
        .limit(1)
        .for('update');
      const invitation = invitations[0];
      if (!invitation) throw new InvitationOperationError('Invitación no encontrada');
      if (invitation.acceptedAt) throw new InvitationOperationError('La invitación ya fue utilizada');
      if (invitation.revokedAt) throw new InvitationOperationError('La invitación ya fue revocada');
      const revokedAt = new Date();
      const updated = await tx
        .update(pgSchema.accountInvitations)
        .set({ revokedAt })
        .where(eq(pgSchema.accountInvitations.id, invitationId))
        .returning();
      const row = updated[0];
      if (!row) throw new InvitationOperationError('No se pudo revocar la invitación');
      return publicInvitation(row);
    });
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    assertActiveAdmin(tx, actorId);
    const invitation = tx
      .select()
      .from(sqliteSchema.accountInvitations)
      .where(eq(sqliteSchema.accountInvitations.id, invitationId))
      .get();
    if (!invitation) throw new InvitationOperationError('Invitación no encontrada');
    if (invitation.acceptedAt) throw new InvitationOperationError('La invitación ya fue utilizada');
    if (invitation.revokedAt) throw new InvitationOperationError('La invitación ya fue revocada');
    const revokedAt = new Date().toISOString();
    tx.update(sqliteSchema.accountInvitations)
      .set({ revokedAt })
      .where(eq(sqliteSchema.accountInvitations.id, invitationId))
      .run();
    return publicInvitation({ ...invitation, revokedAt });
  });
}
