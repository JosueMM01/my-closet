import { operationSuccessResponseSchema, resetPasswordSchema } from '@/lib/domain/validation';
import { rateLimit } from '@/server/auth/rate-limit';
import { jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import { resetPasswordWithToken } from '@/server/services/password-recovery-service';

export const runtime = 'nodejs';

const RESET_PASSWORD_LIMIT = Number(process.env.AUTH_RATE_LIMIT_RESET_PASSWORD ?? 10);
const INVALID_RESET_MESSAGE = 'El enlace no es válido o ha expirado';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, INVALID_RESET_MESSAGE);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`reset-password:${ip}`, RESET_PASSWORD_LIMIT, 60_000)) {
    return jsonError(429, 'Demasiados intentos; espera un momento');
  }
  const reset = await resetPasswordWithToken(parsed.data.token, parsed.data.newPassword);
  if (!reset) return jsonError(400, INVALID_RESET_MESSAGE);
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
