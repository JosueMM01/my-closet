import { passwordResetInspectionResponseSchema, passwordResetInspectionSchema } from '@/lib/domain/validation';
import { guardRateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
import { jsonOk, requireSameOrigin } from '@/server/http';
import { hashPasswordResetToken, isPasswordResetTokenValid } from '@/server/repositories/password-reset-repository';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await guardRateLimit(`reset-inspect:${requestRateLimitIdentity(request)}`, 30);
  if (limited) return limited;
  const input = passwordResetInspectionSchema.safeParse(await request.json().catch(() => null));
  const valid = input.success && await isPasswordResetTokenValid(hashPasswordResetToken(input.data.token), new Date().toISOString());
  return jsonOk(passwordResetInspectionResponseSchema.parse({ valid }));
}
