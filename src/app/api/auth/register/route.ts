import { authResponseSchema, registerSchema } from '@/lib/domain/validation';
import { hashPassword } from '@/server/auth/password';
import { guardRateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
import { createSession } from '@/server/auth/session';
import { isPublicRegistrationEnabled } from '@/server/env';
import { invalidBody, jsonError, jsonOk, requireSameOrigin } from '@/server/http';
import { AccountError, registerAccount } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';

/** Límite ajustable por entorno (tests lo elevan). */
const REGISTER_LIMIT = Number(process.env.AUTH_RATE_LIMIT_REGISTER ?? 10);

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = requestRateLimitIdentity(request);
  const limited = await guardRateLimit(`register:${ip}`, REGISTER_LIMIT);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return invalidBody('Datos de registro inválidos');

  const { email, password, displayName, invitationToken } = parsed.data;
  try {
    const passwordHash = await hashPassword(password);
    const user = await registerAccount({
      email,
      displayName,
      passwordHash,
      invitationToken,
      publicRegistrationEnabled: isPublicRegistrationEnabled(),
    });
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
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AccountError) {
      const status = error.code === 'EMAIL_EXISTS' ? 409 : 403;
      return jsonError(status, error.message);
    }
    throw error;
  }
}
