import { forgotPasswordSchema, operationSuccessResponseSchema } from '@/lib/domain/validation';
import { rateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
import { invalidBody, jsonOk, requireSameOrigin } from '@/server/http';
import { requestPasswordReset } from '@/server/services/password-recovery-service';
import { guardTurnstile } from '@/server/auth/turnstile';

export const runtime = 'nodejs';

const FORGOT_PASSWORD_LIMIT = Number(process.env.AUTH_RATE_LIMIT_FORGOT_PASSWORD ?? 5);

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Correo inválido');

  const ip = requestRateLimitIdentity(request);
  try {
    if (await rateLimit(`forgot-password:${ip}`, FORGOT_PASSWORD_LIMIT, 60_000)) {
      const challengeError = await guardTurnstile(parsed.data.turnstileToken, 'recovery');
      if (challengeError) return challengeError;
      // Por destinatario, aun cuando cambie la IP. Respuesta idéntica exista o no.
      if (!await rateLimit(`recovery-email:${parsed.data.email.toLowerCase()}`, 1, 60_000) ||
          !await rateLimit(`recovery-email-day:${parsed.data.email.toLowerCase()}`, 10, 86_400_000)) {
        return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
      }
      await requestPasswordReset(parsed.data.email);
    }
  } catch {
    // Respuesta genérica incluso si contador/almacenamiento/correo falla: no enviar sin límite.
  }
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
