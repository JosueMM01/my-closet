import type { AdminInvitationCache, AdminUserCache, UserRole, UserStatus } from '@/lib/domain/types';
import { z } from 'zod';
import {
  adminUserResponseSchema,
  adminUsersResponseSchema,
  adminUserUpdateSchema,
  invitationCreateSchema,
  invitationCreatedResponseSchema,
  invitationResponseSchema,
  invitationsResponseSchema,
} from '@/lib/domain/validation';
import { jsonBody, parseClientInput, requestJSON } from '@/lib/api/client';
import { replaceAdminInvitations, replaceAdminUsers } from '@/lib/local/admin-cache';

const adminEntityIdSchema = z.string().uuid('Identificador inválido');

export async function refreshAdminUsers(): Promise<AdminUserCache[]> {
  const response = await requestJSON('/api/admin/users', adminUsersResponseSchema);
  await replaceAdminUsers(response.users);
  return response.users;
}

export async function refreshAdminInvitations(): Promise<AdminInvitationCache[]> {
  const response = await requestJSON('/api/admin/invitations', invitationsResponseSchema);
  await replaceAdminInvitations(response.invitations);
  return response.invitations;
}

export async function createAdminInvitation(input: {
  email: string;
  role: UserRole;
  expiresAt: string;
}) {
  const body = parseClientInput(invitationCreateSchema, input, 'Datos de invitación inválidos');
  const created = await requestJSON(
    '/api/admin/invitations',
    invitationCreatedResponseSchema,
    { method: 'POST', ...jsonBody(body) },
  );
  await refreshAdminInvitations();
  return created;
}

export async function revokeAdminInvitation(id: string): Promise<AdminInvitationCache> {
  const invitationId = parseClientInput(adminEntityIdSchema, id, 'Invitación inválida');
  const invitation = await requestJSON(
    `/api/admin/invitations/${encodeURIComponent(invitationId)}`,
    invitationResponseSchema,
    { method: 'DELETE' },
  );
  await refreshAdminInvitations();
  return invitation;
}

export async function updateAdminUser(
  id: string,
  patch: { role?: UserRole; status?: UserStatus },
): Promise<AdminUserCache> {
  const userId = parseClientInput(adminEntityIdSchema, id, 'Usuario inválido');
  const body = parseClientInput(adminUserUpdateSchema, patch, 'Cambio de usuario inválido');
  const user = await requestJSON(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    adminUserResponseSchema,
    { method: 'PATCH', ...jsonBody(body) },
  );
  await refreshAdminUsers();
  return user;
}
