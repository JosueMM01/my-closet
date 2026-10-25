import { emailChangeRequestedResponseSchema, emailChangeSchema } from '@/lib/domain/validation';
import { verifyPassword } from '@/server/auth/password';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { AccountError, findUserById } from '@/server/repositories/users-repository';
import { requestEmailChange } from '@/server/services/email-change-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const limited = await guardRateLimit(`profile-email:${principal.userId}`, 5);
  if (limited) return limited;
  const parsed = emailChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Datos de correo inválidos');
  const user = await findUserById(principal.userId);
  if (!user || user.status !== 'ACTIVE') return unauthorized();
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return jsonError(403, 'La contraseña actual es incorrecta');
  }
  try {
    if (parsed.data.newEmail === user.email) return jsonError(400, 'Indica un correo diferente al actual');
    const sent = await requestEmailChange(user, parsed.data.newEmail);
    if (!sent) return jsonError(503, 'No se pudo enviar la verificación. Tu correo actual no ha cambiado.');
    return jsonOk(emailChangeRequestedResponseSchema.parse({ pending: true, email: parsed.data.newEmail }));
  } catch (error) {
    if (error instanceof AccountError && error.code === 'EMAIL_EXISTS') {
      return jsonError(409, error.message);
    }
    throw error;
  }
}
