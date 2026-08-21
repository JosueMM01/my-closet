import 'server-only';

import { and, eq } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { getSqlite, sqliteSchema } from '@/server/db';
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
  row: typeof sqliteSchema.authAccounts.$inferSelect,
): GoogleAuthAccountRecord {
  return { ...row, provider: 'GOOGLE' };
}

export async function linkGoogleAccount(input: {
  userId: string;
  providerSubject: string;
  providerEmail: string;
}): Promise<GoogleAuthAccountRecord> {
  const sqlite = await getSqlite();
  const providerEmail = normalizeEmail(input.providerEmail);

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
  const sqlite = await getSqlite();
  const row = await sqlite
    .select()
    .from(sqliteSchema.authAccounts)
    .where(
      and(
        eq(sqliteSchema.authAccounts.userId, userId),
        eq(sqliteSchema.authAccounts.provider, 'GOOGLE'),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
  return row ? toRecord(row) : null;
}

export async function findActiveUserByGoogleSubject(
  providerSubject: string,
): Promise<UserRecord | null> {
  const sqlite = await getSqlite();
  const row = await sqlite
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
  const sqlite = await getSqlite();
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
