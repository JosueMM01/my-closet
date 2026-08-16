import { getEnv, isCloudinaryEnabled } from '@/server/env';
import { getSessionUser } from '@/server/auth/session';
import { jsonError, jsonOk, unauthorized } from '@/server/http';
import { buildDirectUploadSignature } from '@/server/images/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Firma para subida directa navegador→Cloudinary (la imagen no pasa por
 * este servidor). Desactivado sin credenciales; el cliente usa /api/images.
 */
export async function GET() {
  if (!isCloudinaryEnabled()) {
    return jsonError(501, 'Cloudinary no está configurado');
  }
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const env = getEnv();
  const signed = buildDirectUploadSignature(
    user.userId,
    env.CLOUDINARY_API_KEY!,
    env.CLOUDINARY_API_SECRET!,
  );
  return jsonOk({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    ...signed,
  });
}
