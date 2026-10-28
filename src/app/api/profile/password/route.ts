import { operationSuccessResponseSchema, passwordChangeSchema } from '@/lib/domain/validation';
import { verifyPassword } from '@/server/auth/password';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { findUserById } from '@/server/repositories/users-repository';
import { requestPasswordReset } from '@/server/services/password-recovery-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const limited = await guardRateLimit(`profile-password:${principal.userId}`, 5);
  if (limited) return limited;
  const parsed = passwordChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Datos de contraseña inválidos');
  const user = await findUserById(principal.userId);
  if (!user || user.status !== 'ACTIVE') return unauthorized();
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return jsonError(403, 'La contraseña actual es incorrecta');
  }
  try {
    await requestPasswordReset(user.email, { expectedUserId: user.id, expectedPasswordHash: user.passwordHash });
  } catch {
    return jsonError(503, 'No se pudo completar la solicitud. Intenta de nuevo.');
  }
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
