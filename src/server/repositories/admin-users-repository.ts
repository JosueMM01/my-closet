import { and, asc, eq } from 'drizzle-orm';
import type { UserRole, UserStatus } from '@/lib/domain/types';
import { getServerDB, pgSchema, sqliteSchema, type PostgresDB } from '@/server/db';
import { AdminAuthorizationError } from './invitations-repository';
import { adminCapacityMessage, MAX_ACTIVE_ADMINS } from '@/lib/domain/admin-capacity';
import { lockAdminCapacity, pendingAdminReservationsPostgres, pendingAdminReservationsSqlite } from './admin-capacity';

export interface AdminUserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  adminSlot: number | null;
  profileImageId: string | null;
  createdAt: string;
}

export class AdminUserOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminUserOperationError';
  }
}

type AdminUserRow =
  | typeof sqliteSchema.users.$inferSelect
  | typeof pgSchema.users.$inferSelect;

function publicUser(row: AdminUserRow): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    adminSlot: row.adminSlot,
    profileImageId: row.profileImageId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function assertActor(row: AdminUserRow | undefined): void {
  if (row?.role !== 'ADMIN' || row.status !== 'ACTIVE') {
    throw new AdminAuthorizationError();
  }
}

export async function listUsersForAdmin(actorId: string): Promise<AdminUserRecord[]> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return db.postgres.transaction(async (tx) => {
      const actor = await tx
        .select()
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, actorId))
        .limit(1);
      assertActor(actor[0]);
      return (await tx.select().from(pgSchema.users).orderBy(asc(pgSchema.users.createdAt)))
        .map(publicUser);
    });
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    assertActor(
      tx.select().from(sqliteSchema.users).where(eq(sqliteSchema.users.id, actorId)).get(),
    );
    return tx
      .select()
      .from(sqliteSchema.users)
      .orderBy(asc(sqliteSchema.users.createdAt))
      .all()
      .map(publicUser);
  });
}

export async function updateUserForAdmin(input: {
  actorId: string;
  userId: string;
  role?: UserRole;
  status?: UserStatus;
}): Promise<AdminUserRecord> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    return updateUserForAdminPostgres(db.postgres, input);
  }
  const sqlite = db.sqlite;
  return sqlite.transaction((tx) => {
    const actor = tx
      .select()
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.id, input.actorId))
      .get();
    assertActor(actor);
    const target = tx
      .select()
      .from(sqliteSchema.users)
      .where(eq(sqliteSchema.users.id, input.userId))
      .get();
    if (!target) throw new AdminUserOperationError('Usuario no encontrado');

    const role = input.role ?? target.role;
    const status = input.status ?? target.status;
    const remainsActiveAdmin = role === 'ADMIN' && status === 'ACTIVE';
    if (target.id === input.actorId && !remainsActiveAdmin) {
      throw new AdminUserOperationError('No puedes quitarte tu propio acceso de administrador');
    }

    let adminSlot: 1 | 2 | null = null;
    if (remainsActiveAdmin) {
      if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
        if (target.adminSlot !== 1 && target.adminSlot !== 2) {
          throw new AdminUserOperationError('El administrador tiene un slot inválido');
        }
        adminSlot = target.adminSlot;
      } else {
        const activeAdmins = tx
          .select({ adminSlot: sqliteSchema.users.adminSlot })
          .from(sqliteSchema.users)
          .where(
            and(
              eq(sqliteSchema.users.role, 'ADMIN'),
              eq(sqliteSchema.users.status, 'ACTIVE'),
            ),
          )
          .all();
        if (activeAdmins.length + pendingAdminReservationsSqlite(tx) >= MAX_ACTIVE_ADMINS) {
          throw new AdminUserOperationError(adminCapacityMessage(activeAdmins.length));
        }
        const used = new Set(activeAdmins.map((row) => row.adminSlot));
        if (!used.has(1)) adminSlot = 1;
        else if (!used.has(2)) adminSlot = 2;
        else throw new AdminUserOperationError('Ya existen dos administradores activos');
      }
    } else if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
      const activeAdmins = tx
        .select({ id: sqliteSchema.users.id })
        .from(sqliteSchema.users)
        .where(
          and(
            eq(sqliteSchema.users.role, 'ADMIN'),
            eq(sqliteSchema.users.status, 'ACTIVE'),
          ),
        )
        .all();
      if (activeAdmins.length <= 1) {
        throw new AdminUserOperationError('Debe existir al menos un administrador activo');
      }
    }

    tx.update(sqliteSchema.users)
      .set({ role, status, adminSlot })
      .where(eq(sqliteSchema.users.id, target.id))
      .run();
    if (status === 'DISABLED') {
      tx.delete(sqliteSchema.sessions).where(eq(sqliteSchema.sessions.userId, target.id)).run();
    }
    return publicUser({ ...target, role, status, adminSlot });
  });
}

async function updateUserForAdminPostgres(
  postgres: PostgresDB,
  input: {
    actorId: string;
    userId: string;
    role?: UserRole;
    status?: UserStatus;
  },
): Promise<AdminUserRecord> {
  return postgres.transaction(async (tx) => {
    await lockAdminCapacity(tx);
    const actorRows = await tx
      .select()
      .from(pgSchema.users)
      .where(eq(pgSchema.users.id, input.actorId))
      .limit(1);
    assertActor(actorRows[0]);
    const targetRows = await tx
      .select()
      .from(pgSchema.users)
      .where(eq(pgSchema.users.id, input.userId))
      .limit(1)
      .for('update');
    const target = targetRows[0];
    if (!target) throw new AdminUserOperationError('Usuario no encontrado');

    const role = input.role ?? target.role;
    const status = input.status ?? target.status;
    const remainsActiveAdmin = role === 'ADMIN' && status === 'ACTIVE';
    if (target.id === input.actorId && !remainsActiveAdmin) {
      throw new AdminUserOperationError('No puedes quitarte tu propio acceso de administrador');
    }

    let adminSlot: 1 | 2 | null = null;
    if (remainsActiveAdmin) {
      if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
        if (target.adminSlot !== 1 && target.adminSlot !== 2) {
          throw new AdminUserOperationError('El administrador tiene un slot inválido');
        }
        adminSlot = target.adminSlot;
      } else {
        const activeAdmins = await tx
          .select({ adminSlot: pgSchema.users.adminSlot })
          .from(pgSchema.users)
          .where(and(eq(pgSchema.users.role, 'ADMIN'), eq(pgSchema.users.status, 'ACTIVE')))
          .for('update');
        if (activeAdmins.length + await pendingAdminReservationsPostgres(tx) >= MAX_ACTIVE_ADMINS) {
          throw new AdminUserOperationError(adminCapacityMessage(activeAdmins.length));
        }
        const used = new Set(activeAdmins.map((row) => row.adminSlot));
        if (!used.has(1)) adminSlot = 1;
        else if (!used.has(2)) adminSlot = 2;
        else throw new AdminUserOperationError('Ya existen dos administradores activos');
      }
    } else if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
      const activeAdmins = await tx
        .select({ id: pgSchema.users.id })
        .from(pgSchema.users)
        .where(and(eq(pgSchema.users.role, 'ADMIN'), eq(pgSchema.users.status, 'ACTIVE')))
        .for('update');
      if (activeAdmins.length <= 1) {
        throw new AdminUserOperationError('Debe existir al menos un administrador activo');
      }
    }

    const updated = await tx
      .update(pgSchema.users)
      .set({ role, status, adminSlot })
      .where(eq(pgSchema.users.id, target.id))
      .returning();
    if (status === 'DISABLED') {
      await tx.delete(pgSchema.sessions).where(eq(pgSchema.sessions.userId, target.id));
    }
    const row = updated[0];
    if (!row) throw new AdminUserOperationError('No se pudo actualizar el usuario');
    return publicUser(row);
  });
}
