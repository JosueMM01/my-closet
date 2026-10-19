import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getServerDB, pgSchema, sqliteSchema, type ServerDB } from '@/server/db';
import { AccountError, type UserRecord } from './users-repository';

export function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function replaceEmailChangeToken(
  user: UserRecord, newEmail: string, tokenHash: string, expiresAt: Date,
): Promise<void> {
  const db = await getServerDB();
  const values = {
    userId: user.id, newEmail, originalEmail: user.email,
    credentialHash: user.passwordHash, tokenHash,
  };
  if (db.dialect === 'postgres') {
    await db.postgres.transaction(async tx => {
      // Mismo orden de bloqueo que la confirmacion: cuenta, despues solicitud.
      await tx.select({ id: pgSchema.users.id }).from(pgSchema.users)
        .where(eq(pgSchema.users.id, user.id)).for('update');
      await tx.insert(pgSchema.emailChangeTokens).values({ ...values, expiresAt })
        .onConflictDoUpdate({ target: pgSchema.emailChangeTokens.userId, set: { ...values, expiresAt } });
    });
  } else {
    db.sqlite.insert(sqliteSchema.emailChangeTokens)
      .values({ ...values, expiresAt: expiresAt.toISOString() })
      .onConflictDoUpdate({
        target: sqliteSchema.emailChangeTokens.userId,
        set: { ...values, expiresAt: expiresAt.toISOString() },
      }).run();
  }
}

export async function discardEmailChangeToken(userId: string, tokenHash: string): Promise<void> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    await db.postgres.delete(pgSchema.emailChangeTokens).where(and(
      eq(pgSchema.emailChangeTokens.userId, userId), eq(pgSchema.emailChangeTokens.tokenHash, tokenHash),
    ));
  } else {
    db.sqlite.delete(sqliteSchema.emailChangeTokens).where(and(
      eq(sqliteSchema.emailChangeTokens.userId, userId), eq(sqliteSchema.emailChangeTokens.tokenHash, tokenHash),
    )).run();
  }
}

function validRequest(
  user: { status: string; email: string; passwordHash: string } | undefined,
  pending: { originalEmail: string; credentialHash: string; tokenHash: string; expiresAt: string | Date } | undefined,
  tokenHash: string, now: Date,
): boolean {
  return !!user && !!pending && user.status === 'ACTIVE'
    && user.email === pending.originalEmail && user.passwordHash === pending.credentialHash
    && new Date(pending.expiresAt).getTime() > now.getTime()
    && timingSafeEqual(Buffer.from(pending.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'));
}

/** Confirma y revoca sesiones y recuperaciones previas en una sola transaccion. */
export async function consumeEmailChangeToken(
  userId: string, token: string, now = new Date(), database?: ServerDB,
): Promise<string | null> {
  const db = database ?? await getServerDB();
  const tokenHash = hashEmailChangeToken(token);
  try {
    if (db.dialect === 'postgres') {
      return await db.postgres.transaction(async tx => {
        const [user] = await tx.select().from(pgSchema.users)
          .where(eq(pgSchema.users.id, userId)).for('update');
        const [pending] = await tx.select().from(pgSchema.emailChangeTokens)
          .where(eq(pgSchema.emailChangeTokens.userId, userId)).for('update');
        if (!validRequest(user, pending, tokenHash, now) || !pending) return null;
        await tx.update(pgSchema.users).set({ email: pending.newEmail }).where(eq(pgSchema.users.id, userId));
        await tx.delete(pgSchema.emailChangeTokens).where(eq(pgSchema.emailChangeTokens.userId, userId));
        await tx.delete(pgSchema.passwordResetTokens).where(eq(pgSchema.passwordResetTokens.userId, userId));
        await tx.delete(pgSchema.sessions).where(eq(pgSchema.sessions.userId, userId));
        return pending.newEmail;
      });
    }
    return db.sqlite.transaction(tx => {
      const user = tx.select().from(sqliteSchema.users).where(eq(sqliteSchema.users.id, userId)).get();
      const pending = tx.select().from(sqliteSchema.emailChangeTokens)
        .where(eq(sqliteSchema.emailChangeTokens.userId, userId)).get();
      if (!validRequest(user, pending, tokenHash, now) || !pending) return null;
      tx.update(sqliteSchema.users).set({ email: pending.newEmail }).where(eq(sqliteSchema.users.id, userId)).run();
      tx.delete(sqliteSchema.emailChangeTokens).where(eq(sqliteSchema.emailChangeTokens.userId, userId)).run();
      tx.delete(sqliteSchema.passwordResetTokens).where(eq(sqliteSchema.passwordResetTokens.userId, userId)).run();
      tx.delete(sqliteSchema.sessions).where(eq(sqliteSchema.sessions.userId, userId)).run();
      return pending.newEmail;
    });
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    const code = wrapped.cause?.code ?? wrapped.code;
    if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
    }
    throw error;
  }
}
