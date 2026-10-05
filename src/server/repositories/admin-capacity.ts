import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { pgSchema, sqliteSchema, type PostgresDB, type SqliteDB } from '@/server/db';

type PostgresTransaction = Parameters<Parameters<PostgresDB['transaction']>[0]>[0];
type SqliteTransaction = Parameters<Parameters<SqliteDB['transaction']>[0]>[0];

// All capacity writers take this database-local transaction lock BEFORE row locks.
// Transaction-scoped locks are compatible with Neon's transaction pooling.
export const ADMIN_CAPACITY_LOCK = [1296256079, 2] as const;
export async function lockAdminCapacity(tx: PostgresTransaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_CAPACITY_LOCK[0]}, ${ADMIN_CAPACITY_LOCK[1]})`);
}

export async function pendingAdminReservationsPostgres(tx: PostgresTransaction, acceptingId?: string | null): Promise<number> {
  return (await tx.select({ id: pgSchema.accountInvitations.id })
    .from(pgSchema.accountInvitations).where(and(
      eq(pgSchema.accountInvitations.role, 'ADMIN'),
      isNull(pgSchema.accountInvitations.acceptedAt),
      isNull(pgSchema.accountInvitations.revokedAt),
      gt(pgSchema.accountInvitations.expiresAt, new Date()),
      acceptingId ? ne(pgSchema.accountInvitations.id, acceptingId) : undefined,
    )).limit(2)).length;
}

export function pendingAdminReservationsSqlite(tx: SqliteTransaction, acceptingId?: string | null): number {
  return tx.select({ id: sqliteSchema.accountInvitations.id })
    .from(sqliteSchema.accountInvitations).where(and(
      eq(sqliteSchema.accountInvitations.role, 'ADMIN'),
      isNull(sqliteSchema.accountInvitations.acceptedAt),
      isNull(sqliteSchema.accountInvitations.revokedAt),
      gt(sqliteSchema.accountInvitations.expiresAt, new Date().toISOString()),
      acceptingId ? ne(sqliteSchema.accountInvitations.id, acceptingId) : undefined,
    )).limit(2).all().length;
}
