import { emailChangeConfirmSchema, emailChangeResponseSchema } from '@/lib/domain/validation';
import { createSession, getSessionUser } from '@/server/auth/session';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { consumeEmailChangeToken } from '@/server/repositories/email-change-repository';
import { AccountError } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const limited = await guardRateLimit(`profile-email-confirm:${principal.userId}`, 5);
  if (limited) return limited;
  const parsed = emailChangeConfirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Código de verificación inválido');
  try {
    const email = await consumeEmailChangeToken(principal.userId, parsed.data.token);
    if (!email) return jsonError(400, 'El código no es válido o ha vencido. Solicita uno nuevo.');
    // Las sesiones anteriores ya se revocaron dentro de la transaccion.
    await createSession(principal.userId);
    return jsonOk(emailChangeResponseSchema.parse({ email }));
  } catch (error) {
    if (error instanceof AccountError && error.code === 'EMAIL_EXISTS') return jsonError(409, error.message);
    throw error;
  }
}
