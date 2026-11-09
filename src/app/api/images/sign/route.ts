import { cookies } from 'next/headers';
import { getCloudinaryCredentials, getCloudinaryFolder } from '@/server/env';
import { getSessionUser, SESSION_COOKIE } from '@/server/auth/session';
import { deletionSessionBinding } from '@/server/auth/account-deletion';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { buildDirectUploadSignature } from '@/server/images/storage';
import { authorizeCloudinaryUpload, CloudinaryUploadAuthorizationError } from '@/server/repositories/cloudinary-upload-repository';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Firma para subida directa navegador→Cloudinary (la imagen no pasa por
 * este servidor). Desactivado sin credenciales; el cliente usa /api/images.
 */
export async function GET(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const cloudinaryCredentials = getCloudinaryCredentials();
  if (!cloudinaryCredentials) {
    return jsonError(501, 'Cloudinary no está configurado');
  }
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const limited = await guardRateLimit(`image-sign:${user.userId}`, 60);
  if (limited) return limited;
  const imageId = z.string().uuid().safeParse(new URL(request.url).searchParams.get('id'));
  if (!imageId.success) return jsonError(400, 'Identificador de imagen inválido');

  try {
    const cookieStore = await cookies();
    const { sessionId } = deletionSessionBinding(cookieStore.get(SESSION_COOKIE)?.value);
    const authorization = await authorizeCloudinaryUpload({
      userId: user.userId,
      sessionId,
      imageId: imageId.data,
      folder: getCloudinaryFolder(user.userId),
    });
    const signed = buildDirectUploadSignature(
      authorization.folder,
      authorization.publicId,
      authorization.signedAt,
      cloudinaryCredentials.apiSecret,
    );
    return jsonOk({ authorizationId: authorization.id, cloudName: cloudinaryCredentials.cloudName,
      apiKey: cloudinaryCredentials.apiKey, ...signed });
  } catch (error) {
    if (error instanceof CloudinaryUploadAuthorizationError) return jsonError(error.status, error.message);
    throw error;
  }
}
