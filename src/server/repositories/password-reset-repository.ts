import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function replacePasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}): Promise<void> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    await db.postgres.transaction(async (tx) => {
      await tx.delete(pgSchema.passwordResetTokens)
        .where(eq(pgSchema.passwordResetTokens.userId, input.userId));
      await tx.insert(pgSchema.passwordResetTokens).values({
        id: uuid(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: new Date(input.expiresAt),
        createdAt: new Date(input.createdAt),
      });
    });
    return;
  }
  const sqlite = db.sqlite;
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
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const tokens = await tx
        .select({ userId: pgSchema.passwordResetTokens.userId })
        .from(pgSchema.passwordResetTokens)
        .innerJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.passwordResetTokens.userId))
        .where(
          and(
            eq(pgSchema.passwordResetTokens.tokenHash, input.tokenHash),
            isNull(pgSchema.passwordResetTokens.usedAt),
            gt(pgSchema.passwordResetTokens.expiresAt, new Date(input.now)),
            eq(pgSchema.users.status, 'ACTIVE'),
          ),
        )
        .limit(1)
        .for('update');
      const token = tokens[0];
      if (!token) return false;

      const consumed = await tx
        .update(pgSchema.passwordResetTokens)
        .set({ usedAt: new Date(input.now) })
        .where(
          and(
            eq(pgSchema.passwordResetTokens.tokenHash, input.tokenHash),
            isNull(pgSchema.passwordResetTokens.usedAt),
            gt(pgSchema.passwordResetTokens.expiresAt, new Date(input.now)),
          ),
        )
        .returning({ id: pgSchema.passwordResetTokens.id });
      if (consumed.length !== 1) return false;

      const updated = await tx
        .update(pgSchema.users)
        .set({ passwordHash: input.passwordHash })
        .where(and(eq(pgSchema.users.id, token.userId), eq(pgSchema.users.status, 'ACTIVE')))
        .returning({ id: pgSchema.users.id });
      if (updated.length !== 1) throw new Error('No se pudo actualizar la cuenta activa');
      await tx.delete(pgSchema.sessions).where(eq(pgSchema.sessions.userId, token.userId));
      return true;
    });
  }
  const sqlite = db.sqlite;
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
