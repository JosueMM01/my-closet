import {
  invitationCreateSchema,
  invitationCreatedResponseSchema,
  invitationsResponseSchema,
} from '@/lib/domain/validation';
import { requireAdmin } from '@/server/auth/session';
import { guardRateLimit } from '@/server/auth/rate-limit';
import {
  authGuardError,
  invalidBody,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from '@/server/http';
import {
  AdminAuthorizationError,
  InvitationOperationError,
  listInvitations,
} from '@/server/repositories/invitations-repository';
import {
  createAndDeliverInvitation,
  InvitationDeliveryError,
} from '@/server/services/invitation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin();
    return jsonOk(
      invitationsResponseSchema.parse({ invitations: await listInvitations(admin.userId) }),
    );
  } catch (error) {
    const guardResponse = authGuardError(error);
    if (guardResponse) return guardResponse;
    if (error instanceof AdminAuthorizationError) return jsonError(403, error.message);
    throw error;
  }
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = invitationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Datos de invitación inválidos');
  try {
    const admin = await requireAdmin();
    const limited = await guardRateLimit(`admin-invitations:${admin.userId}`, 10);
    if (limited) return limited;
    const created = await createAndDeliverInvitation({ actorId: admin.userId, ...parsed.data });
    return jsonOk(invitationCreatedResponseSchema.parse(created), { status: 201 });
  } catch (error) {
    const guardResponse = authGuardError(error);
    if (guardResponse) return guardResponse;
    if (error instanceof AdminAuthorizationError) return jsonError(403, error.message);
    if (error instanceof InvitationOperationError) return jsonError(409, error.message);
    if (error instanceof InvitationDeliveryError) return jsonError(502, error.message);
    throw error;
  }
}
