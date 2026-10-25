import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getServerDB, pgSchema, sqliteSchema, type ServerDB } from '@/server/db';
import { getAuthSecret } from '@/server/env';
import { AccountError, type UserRecord } from './users-repository';

/** Intentos fallidos permitidos por codigo antes de invalidarlo. */
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;

export type ConfirmedEmailChange = { newEmail: string; originalEmail: string };

/** HMAC con secreto del servidor: un codigo de 6 digitos no se recupera solo con la BD. */
export function hashEmailChangeCode(userId: string, code: string): string {
  return createHmac('sha256', getAuthSecret()).update(JSON.stringify(['email-change', userId, code])).digest('hex');
}

/** Huella de la credencial: detecta cambios de contrasena sin duplicar su hash. */
export function credentialFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex');
}

export async function replaceEmailChangeToken(
  user: UserRecord, newEmail: string, tokenHash: string, expiresAt: Date,
): Promise<void> {
  const db = await getServerDB();
  const values = {
    userId: user.id, newEmail, originalEmail: user.email,
    credentialHash: credentialFingerprint(user.passwordHash), tokenHash, attempts: 0,
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

type PendingRequest = {
  originalEmail: string; credentialHash: string; tokenHash: string; attempts: number; expiresAt: string | Date;
};

function activeRequest(
  user: { status: string; email: string; passwordHash: string } | undefined,
  pending: PendingRequest | undefined, now: Date,
): pending is PendingRequest {
  return !!user && !!pending && user.status === 'ACTIVE'
    && user.email === pending.originalEmail
    && credentialFingerprint(user.passwordHash) === pending.credentialHash
    && pending.attempts < EMAIL_CHANGE_MAX_ATTEMPTS
    && new Date(pending.expiresAt).getTime() > now.getTime();
}

function matches(pending: PendingRequest, tokenHash: string): boolean {
  return timingSafeEqual(Buffer.from(pending.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'));
}

/**
 * Confirma y revoca sesiones y recuperaciones previas en una sola transaccion.
 * Un codigo erroneo suma un intento; al llegar al maximo se elimina la solicitud.
 */
export async function consumeEmailChangeToken(
  userId: string, code: string, now = new Date(), database?: ServerDB,
): Promise<ConfirmedEmailChange | null> {
  const db = database ?? await getServerDB();
  const tokenHash = hashEmailChangeCode(userId, code);
  try {
    if (db.dialect === 'postgres') {
      return await db.postgres.transaction(async tx => {
        const [user] = await tx.select().from(pgSchema.users)
          .where(eq(pgSchema.users.id, userId)).for('update');
        const [pending] = await tx.select().from(pgSchema.emailChangeTokens)
          .where(eq(pgSchema.emailChangeTokens.userId, userId)).for('update');
        if (!activeRequest(user, pending, now) || !pending) return null;
        if (!matches(pending, tokenHash)) {
          const attempts = pending.attempts + 1;
          if (attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
            await tx.delete(pgSchema.emailChangeTokens).where(eq(pgSchema.emailChangeTokens.userId, userId));
          } else {
            await tx.update(pgSchema.emailChangeTokens).set({ attempts })
              .where(eq(pgSchema.emailChangeTokens.userId, userId));
          }
          return null;
        }
        await tx.update(pgSchema.users).set({ email: pending.newEmail }).where(eq(pgSchema.users.id, userId));
        await tx.delete(pgSchema.emailChangeTokens).where(eq(pgSchema.emailChangeTokens.userId, userId));
        await tx.delete(pgSchema.passwordResetTokens).where(eq(pgSchema.passwordResetTokens.userId, userId));
        await tx.delete(pgSchema.sessions).where(eq(pgSchema.sessions.userId, userId));
        return { newEmail: pending.newEmail, originalEmail: pending.originalEmail };
      });
    }
    return db.sqlite.transaction(tx => {
      const user = tx.select().from(sqliteSchema.users).where(eq(sqliteSchema.users.id, userId)).get();
      const pending = tx.select().from(sqliteSchema.emailChangeTokens)
        .where(eq(sqliteSchema.emailChangeTokens.userId, userId)).get();
      if (!activeRequest(user, pending, now) || !pending) return null;
      if (!matches(pending, tokenHash)) {
        const attempts = pending.attempts + 1;
        if (attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
          tx.delete(sqliteSchema.emailChangeTokens).where(eq(sqliteSchema.emailChangeTokens.userId, userId)).run();
        } else {
          tx.update(sqliteSchema.emailChangeTokens).set({ attempts })
            .where(eq(sqliteSchema.emailChangeTokens.userId, userId)).run();
        }
        return null;
      }
      tx.update(sqliteSchema.users).set({ email: pending.newEmail }).where(eq(sqliteSchema.users.id, userId)).run();
      tx.delete(sqliteSchema.emailChangeTokens).where(eq(sqliteSchema.emailChangeTokens.userId, userId)).run();
      tx.delete(sqliteSchema.passwordResetTokens).where(eq(sqliteSchema.passwordResetTokens.userId, userId)).run();
      tx.delete(sqliteSchema.sessions).where(eq(sqliteSchema.sessions.userId, userId)).run();
      return { newEmail: pending.newEmail, originalEmail: pending.originalEmail };
    });
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    const errorCode = wrapped.cause?.code ?? wrapped.code;
    if (errorCode === '23505' || errorCode === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
    }
    throw error;
  }
}
