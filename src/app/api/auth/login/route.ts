import { authResponseSchema, loginSchema } from '@/lib/domain/validation';
import { verifyPassword } from '@/server/auth/password';
import { guardRateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
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
  const ip = requestRateLimitIdentity(request);
  const ipLimited = await guardRateLimit(`login-ip:${ip}`, 30);
  if (ipLimited) return ipLimited;
  const limited = await guardRateLimit(`login:${ip}:${parsed.data.email.toLowerCase()}`, 5);
  if (limited) return limited;

  const user = await findUserByEmail(parsed.data.email);
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid || user.status !== 'ACTIVE') {
    return jsonError(401, 'Correo o contraseña incorrectos');
  }

  await createSession(user.id);
  return jsonOk(
    authResponseSchema.parse({
      profile: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        role: user.role,
        status: user.status,
        profileImageId: user.profileImageId,
      },
    }),
  );
}
