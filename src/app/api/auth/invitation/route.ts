import {
  invitationInspectionRequestSchema,
  invitationInspectionResponseSchema,
} from '@/lib/domain/validation';
import { guardRateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
import { isGoogleEnabled } from '@/server/env';
import { invalidBody, jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import {
  inspectInvitationToken,
  InvitationOperationError,
} from '@/server/repositories/invitations-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const ip = requestRateLimitIdentity(request);
  const limited = await guardRateLimit(`invitation-inspect:${ip}`, 30);
  if (limited) return limited;
  const parsed = invitationInspectionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return invalidBody('La invitación no es válida');
  try {
    const invitation = await inspectInvitationToken(parsed.data.token);
    return jsonOk(
      invitationInspectionResponseSchema.parse({
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        googleAvailable: isGoogleEnabled(),
      }),
    );
  } catch (error) {
    if (error instanceof InvitationOperationError) return jsonError(410, error.message);
    throw error;
  }
}
