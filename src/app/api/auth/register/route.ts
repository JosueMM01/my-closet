import { registerSchema } from '@/lib/domain/validation';
import { hashPassword } from '@/server/auth/password';
import { rateLimit } from '@/server/auth/rate-limit';
import { createSession } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import { createUser, userExists } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';

/** Límite ajustable por entorno (tests lo elevan). */
const REGISTER_LIMIT = Number(process.env.AUTH_RATE_LIMIT_REGISTER ?? 10);

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`register:${ip}`, REGISTER_LIMIT, 60_000)) {
    return jsonError(429, 'Demasiados intentos; espera un momento');
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return invalidBody('Datos de registro inválidos');

  const { email, password, displayName } = parsed.data;
  if (await userExists(email)) {
    return jsonError(409, 'Ya existe una cuenta con ese correo');
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, displayName, passwordHash });
  await createSession(user.id);

  return jsonOk(
    { profile: { userId: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt } },
    { status: 201 },
  );
}
