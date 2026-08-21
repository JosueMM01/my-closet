import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { getSqlite, sqliteSchema } from '@/server/db';

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function replacePasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}): Promise<void> {
  const sqlite = await getSqlite();
  sqlite.transaction((tx) => {
    tx.delete(sqliteSchema.passwordResetTokens)
      .where(eq(sqliteSchema.passwordResetTokens.userId, input.userId))
      .run();
    tx.insert(sqliteSchema.passwordResetTokens)
      .values({ id: uuid(), ...input })
      .run();
  });
}

export async function consumePasswordResetToken(input: {
  tokenHash: string;
  passwordHash: string;
  now: string;
}): Promise<boolean> {
  const sqlite = await getSqlite();
  return sqlite.transaction((tx) => {
    const token = tx
      .select({ userId: sqliteSchema.passwordResetTokens.userId })
      .from(sqliteSchema.passwordResetTokens)
      .innerJoin(
        sqliteSchema.users,
        eq(sqliteSchema.users.id, sqliteSchema.passwordResetTokens.userId),
      )
      .where(
        and(
          eq(sqliteSchema.passwordResetTokens.tokenHash, input.tokenHash),
          isNull(sqliteSchema.passwordResetTokens.usedAt),
          gt(sqliteSchema.passwordResetTokens.expiresAt, input.now),
          eq(sqliteSchema.users.status, 'ACTIVE'),
        ),
      )
      .get();
    if (!token) return false;

    const consumed = tx
      .update(sqliteSchema.passwordResetTokens)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(sqliteSchema.passwordResetTokens.tokenHash, input.tokenHash),
          isNull(sqliteSchema.passwordResetTokens.usedAt),
          gt(sqliteSchema.passwordResetTokens.expiresAt, input.now),
        ),
      )
      .run();
    if (consumed.changes !== 1) return false;

    const updated = tx
      .update(sqliteSchema.users)
      .set({ passwordHash: input.passwordHash })
      .where(and(eq(sqliteSchema.users.id, token.userId), eq(sqliteSchema.users.status, 'ACTIVE')))
      .run();
    if (updated.changes !== 1) {
      throw new Error('No se pudo actualizar la cuenta activa');
    }
    tx.delete(sqliteSchema.sessions)
      .where(eq(sqliteSchema.sessions.userId, token.userId))
      .run();
    return true;
  });
}
