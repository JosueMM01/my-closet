import { z } from 'zod';
import { invitationResponseSchema } from '@/lib/domain/validation';
import { requireAdmin } from '@/server/auth/session';
import { authGuardError, jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import {
  AdminAuthorizationError,
  InvitationOperationError,
  revokeInvitation,
} from '@/server/repositories/invitations-repository';

export const runtime = 'nodejs';

const invitationIdSchema = z.string().uuid();

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsedId = invitationIdSchema.safeParse((await params).id);
  if (!parsedId.success) return jsonError(400, 'Identificador de invitación inválido');
  try {
    const admin = await requireAdmin();
    return jsonOk(
      invitationResponseSchema.parse(await revokeInvitation(admin.userId, parsedId.data)),
    );
  } catch (error) {
    const guardResponse = authGuardError(error);
    if (guardResponse) return guardResponse;
    if (error instanceof AdminAuthorizationError) return jsonError(403, error.message);
    if (error instanceof InvitationOperationError) return jsonError(409, error.message);
    throw error;
  }
}
