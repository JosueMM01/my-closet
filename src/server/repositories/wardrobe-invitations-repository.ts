import 'server-only';

import { and, eq, isNull, or } from 'drizzle-orm';
import type { Permission } from '@/lib/domain/types';
import type { SessionUser } from '@/server/auth/session';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';

export type WardrobeInvitationDetails = {
  permission: Permission;
  accepted: boolean;
};

export type WardrobeInvitationErrorCode =
  | 'NOT_FOUND'
  | 'EMAIL_MISMATCH'
  | 'ALREADY_ACCEPTED'
  | 'SELF_INVITATION';

export class WardrobeInvitationError extends Error {
  constructor(public readonly code: WardrobeInvitationErrorCode) {
    super(code);
    this.name = 'WardrobeInvitationError';
  }
}

type InvitationRow =
  | typeof pgSchema.wardrobeShares.$inferSelect
  | typeof sqliteSchema.wardrobeShares.$inferSelect;

function validateInvitation(row: InvitationRow | undefined, principal: SessionUser): InvitationRow {
  if (!row || row.deletedAt || !row.granteeEmail) {
    throw new WardrobeInvitationError('NOT_FOUND');
  }
  if (row.grantorId === principal.userId) {
    throw new WardrobeInvitationError('SELF_INVITATION');
  }
  if (row.granteeEmail.trim().toLowerCase() !== principal.email.trim().toLowerCase()) {
    throw new WardrobeInvitationError('EMAIL_MISMATCH');
  }
  if (row.granteeId && row.granteeId !== principal.userId) {
    throw new WardrobeInvitationError('ALREADY_ACCEPTED');
  }
  return row;
}

function toDetails(row: InvitationRow): WardrobeInvitationDetails {
  return { permission: row.permission, accepted: Boolean(row.acceptedAt) };
}

export async function inspectWardrobeInvitation(
  token: string,
  principal: SessionUser,
): Promise<WardrobeInvitationDetails> {
  const db = await getServerDB();
  const rows = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.wardrobeShares)
        .where(eq(pgSchema.wardrobeShares.inviteToken, token))
        .limit(1)
    : await db.sqlite
        .select()
        .from(sqliteSchema.wardrobeShares)
        .where(eq(sqliteSchema.wardrobeShares.inviteToken, token))
        .limit(1);
  return toDetails(validateInvitation(rows[0], principal));
}

export async function acceptWardrobeInvitation(
  token: string,
  principal: SessionUser,
): Promise<WardrobeInvitationDetails> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(pgSchema.wardrobeShares)
        .where(eq(pgSchema.wardrobeShares.inviteToken, token))
        .limit(1)
        .for('update');
      const row = validateInvitation(rows[0], principal);
      if (row.granteeId === principal.userId && row.acceptedAt) return toDetails(row);

      const now = new Date().toISOString();
      const updated = await tx
        .update(pgSchema.wardrobeShares)
        .set({
          granteeId: principal.userId,
          acceptedAt: now,
          updatedAt: now,
          serverUpdatedAt: new Date(now),
          version: row.version + 1,
        })
        .where(and(
          eq(pgSchema.wardrobeShares.id, row.id),
          or(isNull(pgSchema.wardrobeShares.granteeId), eq(pgSchema.wardrobeShares.granteeId, principal.userId)),
        ))
        .returning();
      const accepted = updated[0];
      if (!accepted) throw new WardrobeInvitationError('ALREADY_ACCEPTED');
      return toDetails(accepted);
    });
  }

  return db.sqlite.transaction((tx) => {
    const row = tx
      .select()
      .from(sqliteSchema.wardrobeShares)
      .where(eq(sqliteSchema.wardrobeShares.inviteToken, token))
      .limit(1)
      .get();
    const invitation = validateInvitation(row, principal);
    if (invitation.granteeId === principal.userId && invitation.acceptedAt) {
      return toDetails(invitation);
    }

    const now = new Date().toISOString();
    const accepted = tx
      .update(sqliteSchema.wardrobeShares)
      .set({
        granteeId: principal.userId,
        acceptedAt: now,
        updatedAt: now,
        serverUpdatedAt: now,
          version: invitation.version + 1,
      })
      .where(and(
        eq(sqliteSchema.wardrobeShares.id, invitation.id),
        or(isNull(sqliteSchema.wardrobeShares.granteeId), eq(sqliteSchema.wardrobeShares.granteeId, principal.userId)),
      ))
      .returning()
      .get();
    if (!accepted) throw new WardrobeInvitationError('ALREADY_ACCEPTED');
    return toDetails(accepted);
  });
}
