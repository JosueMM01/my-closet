import { z } from 'zod';
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
