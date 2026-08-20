import type { AdminInvitationCache, AdminUserCache } from '@/lib/domain/types';
import { getDB } from './db';

export async function replaceAdminUsers(users: AdminUserCache[]): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.adminUsers, async () => {
    await db.adminUsers.clear();
    await db.adminUsers.bulkPut(users);
  });
}

export async function replaceAdminInvitations(
  invitations: AdminInvitationCache[],
): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.adminInvitations, async () => {
    await db.adminInvitations.clear();
    await db.adminInvitations.bulkPut(invitations);
  });
}

export async function clearAdminCache(): Promise<void> {
  const db = getDB();
  await db.transaction('rw', [db.adminUsers, db.adminInvitations], async () => {
    await Promise.all([db.adminUsers.clear(), db.adminInvitations.clear()]);
  });
}
