import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/domain/constants';
import { getSessionUser } from '@/server/auth/session';
import { getImageStorage } from '@/server/images/storage';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';

export const runtime = 'nodejs';

/**
 * Subida de imagen procesada en el navegador (WebP ≤1080px).
 * Con Cloudinary configurado, el navegador sube directo al CDN con firma
 * de /api/images/sign; este endpoint es el equivalente local.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getSessionUser();
  if (!user) return unauthorized();

  const form = await request.formData().catch(() => null);
  if (!form) return invalidBody();

  const id = form.get('id');
  const file = form.get('file');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return invalidBody('id inválido');
  if (!(file instanceof File)) return invalidBody('Falta el archivo');
  if (file.size === 0 || file.size > 3 * 1024 * 1024) {
    return jsonError(413, 'La imagen procesada supera el tamaño permitido');
  }
  const mime = file.type || 'application/octet-stream';
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    return jsonError(415, 'Tipo de imagen no permitido');
  }

  const data = Buffer.from(await file.arrayBuffer());
  const storage = getImageStorage();
  const { url } = await storage.put({ id, userId: user.userId, data, mimeType: mime });

  return jsonOk({ remoteUrl: url, storage: storage.kind }, { status: 201 });
}
