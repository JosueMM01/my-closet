import { z } from 'zod';
import { cookies } from 'next/headers';
import { getEnv } from '@/server/env';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { verifyPassword } from '@/server/auth/password';
import { SESSION_COOKIE } from '@/server/auth/session';
import { deletionSessionBinding } from '@/server/auth/account-deletion';
import { findUserById } from '@/server/repositories/users-repository';
import { credentialFingerprint } from '@/server/repositories/email-change-repository';
import { AccountDeletionError, deleteDisabledAccountForAdmin } from '@/server/repositories/account-deletion-repository';
import { adminAccountDeletionInputSchema, accountDeletionResponseSchema } from '@/lib/domain/validation';
import { adminUserResponseSchema, adminUserUpdateSchema } from '@/lib/domain/validation';
import { requireAdmin } from '@/server/auth/session';
import {
  authGuardError,
  invalidBody,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from '@/server/http';
import {
  AdminUserOperationError,
  updateUserForAdmin,
} from '@/server/repositories/admin-users-repository';
import { AdminAuthorizationError } from '@/server/repositories/invitations-repository';

export const runtime = 'nodejs';

const userIdSchema = z.string().uuid();

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const env = getEnv();
  if (!env.ACCOUNT_DELETION_ENABLED || !env.ADMIN_ACCOUNT_DELETION_ENABLED) {
    return jsonError(404, 'La baja administrativa todavía no está habilitada');
  }
  try {
    const admin = await requireAdmin();
    const limited = await guardRateLimit(`admin-account-deletion:${admin.userId}`, 5);
    if (limited) return limited;
    const userId = userIdSchema.safeParse((await params).id);
    const body = adminAccountDeletionInputSchema.safeParse(await request.json().catch(() => null));
    if (!userId.success || !body.success) return invalidBody('Confirma la baja e introduce tu contraseña de administrador');
    const actor = await findUserById(admin.userId);
    if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN') return jsonError(403, 'No tienes permisos de administrador');
    if (!await verifyPassword(body.data.currentPassword, actor.passwordHash)) return jsonError(403, 'Tu contraseña de administrador es incorrecta');
    const store = await cookies();
    const binding = deletionSessionBinding(store.get(SESSION_COOKIE)?.value);
    const result = await deleteDisabledAccountForAdmin({
      actorId: actor.id, userId: userId.data, sessionId: binding.sessionId,
      credentialHash: credentialFingerprint(actor.passwordHash),
    });
    // Do not revoke or replace the administrator's own cookie.
    return Response.json(accountDeletionResponseSchema.parse(result), {
      status: 202, headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const guarded = authGuardError(error);
    if (guarded) return guarded;
    if (error instanceof AccountDeletionError) return jsonError(error.status, error.message);
    return jsonError(503, 'No se pudo confirmar la baja. Actualiza las cuentas antes de volver a intentarlo.');
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const userId = userIdSchema.safeParse((await params).id);
  if (!userId.success) return jsonError(400, 'Identificador de usuario inválido');
  const body = adminUserUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return invalidBody('Cambio de usuario inválido');
  try {
    const admin = await requireAdmin();
    const updated = await updateUserForAdmin({
      actorId: admin.userId,
      userId: userId.data,
      ...body.data,
    });
    return jsonOk(
      adminUserResponseSchema.parse({
        userId: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        status: updated.status,
        adminSlot: updated.adminSlot,
        profileImageId: updated.profileImageId,
        createdAt: updated.createdAt,
      }),
    );
  } catch (error) {
    const guardResponse = authGuardError(error);
    if (guardResponse) return guardResponse;
    if (error instanceof AdminAuthorizationError) return jsonError(403, error.message);
    if (error instanceof AdminUserOperationError) return jsonError(409, error.message);
    throw error;
  }
}
