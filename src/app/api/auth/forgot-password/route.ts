import { forgotPasswordSchema, operationSuccessResponseSchema } from '@/lib/domain/validation';
import { rateLimit } from '@/server/auth/rate-limit';
import { invalidBody, jsonOk, requireSameOrigin } from '@/server/http';
import { requestPasswordReset } from '@/server/services/password-recovery-service';

export const runtime = 'nodejs';

const FORGOT_PASSWORD_LIMIT = Number(process.env.AUTH_RATE_LIMIT_FORGOT_PASSWORD ?? 5);

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Correo inválido');

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimit(`forgot-password:${ip}`, FORGOT_PASSWORD_LIMIT, 60_000)) {
    try {
      await requestPasswordReset(parsed.data.email);
    } catch {
      // No se revela si falló la cuenta, el almacenamiento o el proveedor de correo.
    }
  }
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
