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
  adminAccountDeletionInputSchema,
  accountDeletionResponseSchema,
} from '@/lib/domain/validation';
import { jsonBody, parseClientInput, requestJSON } from '@/lib/api/client';
import { replaceAdminInvitations, replaceAdminUsers } from '@/lib/local/admin-cache';

const adminEntityIdSchema = z.string().uuid('Identificador inválido');

export async function refreshAdminUsers(): Promise<AdminUserCache[]> {
  return (await refreshAdminUsersState()).users;
}

export async function refreshAdminUsersState() {
  const response = await requestJSON('/api/admin/users', adminUsersResponseSchema);
  await replaceAdminUsers(response.users);
  return response;
}

/** A successful deletion must not be reported as failed if a cache refresh fails. */
export async function deleteAdminAccount(id: string, input: z.input<typeof adminAccountDeletionInputSchema>) {
  const userId = parseClientInput(adminEntityIdSchema, id, 'Usuario inválido');
  const body = parseClientInput(adminAccountDeletionInputSchema, input, 'Confirma la baja y tu contraseña');
  return requestJSON(`/api/admin/users/${encodeURIComponent(userId)}`, accountDeletionResponseSchema,
    { method: 'DELETE', ...jsonBody(body) });
}

export async function refreshAdminInvitations(): Promise<AdminInvitationCache[]> {
  const response = await requestJSON('/api/admin/invitations', invitationsResponseSchema);
  await replaceAdminInvitations(response.invitations);
  return response.invitations;
}

export async function createAdminInvitation(input: {
  email: string;
  role: UserRole;
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
