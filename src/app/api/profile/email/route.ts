import { emailChangeResponseSchema, emailChangeSchema } from '@/lib/domain/validation';
import { verifyPassword } from '@/server/auth/password';
import { getSessionUser, rotateAllSessions } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { AccountError, findUserById, updateEmail } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const parsed = emailChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Datos de correo inválidos');
  const user = await findUserById(principal.userId);
  if (!user || user.status !== 'ACTIVE') return unauthorized();
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return jsonError(403, 'La contraseña actual es incorrecta');
  }
  try {
    const updated = await updateEmail(user.id, parsed.data.newEmail);
    if (!updated) return unauthorized();
    await rotateAllSessions(user.id);
    return jsonOk(emailChangeResponseSchema.parse({ email: updated.email }));
  } catch (error) {
    if (error instanceof AccountError && error.code === 'EMAIL_EXISTS') {
      return jsonError(409, error.message);
    }
    throw error;
  }
}
