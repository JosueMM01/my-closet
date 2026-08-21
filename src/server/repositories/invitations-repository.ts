import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { UserRole } from '@/lib/domain/types';
import { uuid } from '@/lib/domain/ids';
import { getSqlite, sqliteSchema } from '@/server/db';
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
  row: typeof sqliteSchema.accountInvitations.$inferSelect,
): InvitationRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    acceptedBy: row.acceptedBy,
    createdAt: row.createdAt,
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
  const sqlite = await getSqlite();
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
  return sqlite.transaction((tx) => {
    assertActiveAdmin(tx, input.actorId);
    tx.insert(sqliteSchema.accountInvitations)
      .values({ ...invitation, tokenHash: hashInvitationToken(token) })
      .run();
    return { invitation, token };
  });
}

export async function listInvitations(actorId: string): Promise<InvitationRecord[]> {
  const sqlite = await getSqlite();
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
  const sqlite = await getSqlite();
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
