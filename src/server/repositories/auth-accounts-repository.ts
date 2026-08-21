import 'server-only';

import { and, eq } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';
import { normalizeEmail, type UserRecord } from '@/server/repositories/users-repository';

export interface GoogleAuthAccountRecord {
  id: string;
  userId: string;
  provider: 'GOOGLE';
  providerSubject: string;
  providerEmail: string;
  createdAt: string;
}

export class AuthAccountError extends Error {
  constructor(public readonly code: 'ACTOR_INVALID' | 'EMAIL_MISMATCH' | 'ALREADY_LINKED') {
    super('No se pudo modificar la cuenta de acceso');
    this.name = 'AuthAccountError';
  }
}

function toRecord(
  row:
    | typeof sqliteSchema.authAccounts.$inferSelect
    | typeof pgSchema.authAccounts.$inferSelect,
): GoogleAuthAccountRecord {
  return {
    ...row,
    provider: 'GOOGLE',
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export async function linkGoogleAccount(input: {
  userId: string;
  providerSubject: string;
  providerEmail: string;
}): Promise<GoogleAuthAccountRecord> {
  const db = await getServerDB();
  const providerEmail = normalizeEmail(input.providerEmail);

  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actors = await tx
        .select({ email: pgSchema.users.email, status: pgSchema.users.status })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, input.userId))
        .limit(1);
      const actor = actors[0];
      if (!actor || actor.status !== 'ACTIVE') throw new AuthAccountError('ACTOR_INVALID');
      if (normalizeEmail(actor.email) !== providerEmail) throw new AuthAccountError('EMAIL_MISMATCH');

      const bySubject = await tx
        .select()
        .from(pgSchema.authAccounts)
        .where(
          and(
            eq(pgSchema.authAccounts.provider, 'GOOGLE'),
            eq(pgSchema.authAccounts.providerSubject, input.providerSubject),
          ),
        )
        .limit(1);
      const byUser = await tx
        .select()
        .from(pgSchema.authAccounts)
        .where(
          and(
            eq(pgSchema.authAccounts.userId, input.userId),
            eq(pgSchema.authAccounts.provider, 'GOOGLE'),
          ),
        )
        .limit(1);
      if (bySubject[0] || byUser[0]) {
        if (
          bySubject[0]?.userId === input.userId &&
          byUser[0]?.providerSubject === input.providerSubject
        ) {
          return toRecord(bySubject[0]);
        }
        throw new AuthAccountError('ALREADY_LINKED');
      }

      try {
        const inserted = await tx
          .insert(pgSchema.authAccounts)
          .values({
            id: uuid(),
            userId: input.userId,
            provider: 'GOOGLE',
            providerSubject: input.providerSubject,
            providerEmail,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new AuthAccountError('ALREADY_LINKED');
        return toRecord(row);
      } catch (error) {
        if (error instanceof AuthAccountError) throw error;
        throw new AuthAccountError('ALREADY_LINKED');
      }
    });
  }
  const sqlite = db.sqlite;

  return sqlite.transaction((tx) => {
    const actor = tx
      .select({ email: sqliteSchema.users.email, status: sqliteSchema.users.status })
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.id, input.userId))
      .get();
    if (!actor || actor.status !== 'ACTIVE') throw new AuthAccountError('ACTOR_INVALID');
    if (normalizeEmail(actor.email) !== providerEmail) throw new AuthAccountError('EMAIL_MISMATCH');

    const bySubject = tx
      .select()
      .from(sqliteSchema.authAccounts)
      .where(
        and(
          eq(sqliteSchema.authAccounts.provider, 'GOOGLE'),
          eq(sqliteSchema.authAccounts.providerSubject, input.providerSubject),
        ),
      )
      .get();
    const byUser = tx
      .select()
      .from(sqliteSchema.authAccounts)
      .where(
        and(
          eq(sqliteSchema.authAccounts.userId, input.userId),
          eq(sqliteSchema.authAccounts.provider, 'GOOGLE'),
        ),
      )
      .get();

    if (bySubject || byUser) {
      if (bySubject?.userId === input.userId && byUser?.providerSubject === input.providerSubject) {
        return toRecord(bySubject);
      }
      throw new AuthAccountError('ALREADY_LINKED');
    }

    const record: GoogleAuthAccountRecord = {
      id: uuid(),
      userId: input.userId,
      provider: 'GOOGLE',
      providerSubject: input.providerSubject,
      providerEmail,
      createdAt: new Date().toISOString(),
    };
    try {
      tx.insert(sqliteSchema.authAccounts).values(record).run();
    } catch {
      throw new AuthAccountError('ALREADY_LINKED');
    }
    return record;
  });
}

export async function findGoogleAccountByUserId(
  userId: string,
): Promise<GoogleAuthAccountRecord | null> {
  const db = await getServerDB();
  const row = db.dialect === 'postgres'
    ? await db.postgres
        .select()
        .from(pgSchema.authAccounts)
        .where(and(eq(pgSchema.authAccounts.userId, userId), eq(pgSchema.authAccounts.provider, 'GOOGLE')))
        .limit(1)
        .then((rows) => rows[0])
    : await db.sqlite
        .select()
        .from(sqliteSchema.authAccounts)
        .where(and(eq(sqliteSchema.authAccounts.userId, userId), eq(sqliteSchema.authAccounts.provider, 'GOOGLE')))
        .limit(1)
        .then((rows) => rows[0]);
  return row ? toRecord(row) : null;
}

export async function findActiveUserByGoogleSubject(
  providerSubject: string,
): Promise<UserRecord | null> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const row = await db.postgres
      .select({ user: pgSchema.users })
      .from(pgSchema.authAccounts)
      .innerJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.authAccounts.userId))
      .where(
        and(
          eq(pgSchema.authAccounts.provider, 'GOOGLE'),
          eq(pgSchema.authAccounts.providerSubject, providerSubject),
          eq(pgSchema.users.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) return null;
    return { ...row.user, createdAt: row.user.createdAt.toISOString() };
  }
  const row = await db.sqlite
    .select({ user: sqliteSchema.users })
    .from(sqliteSchema.authAccounts)
    .innerJoin(sqliteSchema.users, eq(sqliteSchema.users.id, sqliteSchema.authAccounts.userId))
    .where(
      and(
        eq(sqliteSchema.authAccounts.provider, 'GOOGLE'),
        eq(sqliteSchema.authAccounts.providerSubject, providerSubject),
        eq(sqliteSchema.users.status, 'ACTIVE'),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
  return row?.user ?? null;
}

export async function unlinkGoogleAccount(userId: string): Promise<boolean> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actors = await tx
        .select({ status: pgSchema.users.status })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, userId))
        .limit(1);
      const actor = actors[0];
      if (!actor || actor.status !== 'ACTIVE') throw new AuthAccountError('ACTOR_INVALID');
      const result = await tx
        .delete(pgSchema.authAccounts)
        .where(and(eq(pgSchema.authAccounts.userId, userId), eq(pgSchema.authAccounts.provider, 'GOOGLE')))
        .returning({ id: pgSchema.authAccounts.id });
      return result.length === 1;
    });
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    const actor = tx
      .select({ status: sqliteSchema.users.status })
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.id, userId))
      .get();
    if (!actor || actor.status !== 'ACTIVE') throw new AuthAccountError('ACTOR_INVALID');
    const result = tx
      .delete(sqliteSchema.authAccounts)
      .where(
        and(
          eq(sqliteSchema.authAccounts.userId, userId),
          eq(sqliteSchema.authAccounts.provider, 'GOOGLE'),
        ),
      )
      .run();
    return result.changes === 1;
  });
}
