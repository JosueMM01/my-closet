import type { UserRole } from './types';

export const MAX_ACTIVE_ADMINS = 2;

export function isPendingInvitation(invitation: {
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}, now: number): boolean {
  return !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > now;
}

export function reservedAdminSeats(invitations: Array<{
  role: UserRole;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}>, now: number): number {
  return invitations.filter((invitation) => invitation.role === 'ADMIN' && isPendingInvitation(invitation, now)).length;
}

export function adminCapacityMessage(activeAdmins: number): string {
  return activeAdmins >= MAX_ACTIVE_ADMINS
    ? 'Ya existen dos administradores activos; no hay plazas disponibles.'
    : 'El cupo de administrador está reservado por invitaciones pendientes. Revoca una invitación ADMIN o espera a que caduque para liberar la plaza.';
}
