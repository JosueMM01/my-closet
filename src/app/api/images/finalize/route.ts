import { cloudinaryFinalizeRequestSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import { guardRateLimit } from '@/server/auth/rate-limit';
import {
  finalizeDirectCloudinaryUpload,
  ImageOwnershipError,
} from '@/server/images/storage';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getSessionUser();
  if (!user) return unauthorized();
  const limited = await guardRateLimit(`image-finalize:${user.userId}`, 120);
  if (limited) return limited;
  const parsed = cloudinaryFinalizeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return invalidBody();

  try {
    const image = await finalizeDirectCloudinaryUpload(user.userId, parsed.data.id);
    return jsonOk({ image }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageOwnershipError) {
      return jsonError(409, 'El identificador de imagen ya está en uso');
    }
    throw error;
  }
}
