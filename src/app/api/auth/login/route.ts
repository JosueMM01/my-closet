import { loginSchema } from '@/lib/domain/validation';
import { verifyPassword } from '@/server/auth/password';
import { rateLimit } from '@/server/auth/rate-limit';
import { createSession } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import { findUserByEmail } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return invalidBody('Datos de acceso inválidos');

  // Throttle por IP+email: 5 intentos / 60 s (mitiga fuerza bruta).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`login:${ip}:${parsed.data.email.toLowerCase()}`, 5, 60_000)) {
    return jsonError(429, 'Demasiados intentos; espera un momento');
  }

  const user = await findUserByEmail(parsed.data.email);
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) {
    return jsonError(401, 'Correo o contraseña incorrectos');
  }

  await createSession(user.id);
  return jsonOk({
    profile: { userId: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt },
  });
}
