import { and, asc, eq } from 'drizzle-orm';
import type { UserRole, UserStatus } from '@/lib/domain/types';
import { getSqlite, sqliteSchema } from '@/server/db';
import { AdminAuthorizationError } from './invitations-repository';

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

function publicUser(row: typeof sqliteSchema.users.$inferSelect): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    adminSlot: row.adminSlot,
    profileImageId: row.profileImageId,
    createdAt: row.createdAt,
  };
}

function assertActor(row: typeof sqliteSchema.users.$inferSelect | undefined): void {
  if (row?.role !== 'ADMIN' || row.status !== 'ACTIVE') {
    throw new AdminAuthorizationError();
  }
}

export async function listUsersForAdmin(actorId: string): Promise<AdminUserRecord[]> {
  const sqlite = await getSqlite();
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
  const sqlite = await getSqlite();
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
