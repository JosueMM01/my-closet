import {
  invitationInspectionRequestSchema,
  invitationInspectionResponseSchema,
} from '@/lib/domain/validation';
import { rateLimit } from '@/server/auth/rate-limit';
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
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`invitation-inspect:${ip}`, 30, 60_000)) {
    return jsonError(429, 'Demasiados intentos; espera un momento');
  }
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
