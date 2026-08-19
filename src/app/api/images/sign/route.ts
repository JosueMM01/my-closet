import { getCloudinaryCredentials } from '@/server/env';
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
  const cloudinaryCredentials = getCloudinaryCredentials();
  if (!cloudinaryCredentials) {
    return jsonError(501, 'Cloudinary no está configurado');
  }
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const signed = buildDirectUploadSignature(
    user.userId,
    cloudinaryCredentials.apiKey,
    cloudinaryCredentials.apiSecret,
  );
  return jsonOk({
    cloudName: cloudinaryCredentials.cloudName,
    apiKey: cloudinaryCredentials.apiKey,
    ...signed,
  });
}
