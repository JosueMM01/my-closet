import { cookies } from 'next/headers';
import { cloudinaryFinalizeRequestSchema } from '@/lib/domain/validation';
import { getSessionUser, SESSION_COOKIE } from '@/server/auth/session';
import { deletionSessionBinding } from '@/server/auth/account-deletion';
import { guardRateLimit } from '@/server/auth/rate-limit';
import {
  finalizeDirectCloudinaryUpload,
  CloudinaryUploadNotFoundError,
  ImageOwnershipError,
} from '@/server/images/storage';
import { CloudinaryUploadAuthorizationError } from '@/server/repositories/cloudinary-upload-repository';
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
    const cookieStore = await cookies();
    const { sessionId } = deletionSessionBinding(cookieStore.get(SESSION_COOKIE)?.value);
    const image = await finalizeDirectCloudinaryUpload(user.userId, parsed.data.id, parsed.data.authorizationId, sessionId);
    return jsonOk({ image }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageOwnershipError) return jsonError(409, 'El identificador de imagen ya está en uso');
    if (error instanceof CloudinaryUploadNotFoundError) return jsonError(409, error.message);
    if (error instanceof CloudinaryUploadAuthorizationError) return jsonError(error.status, error.message);
    throw error;
  }
}
