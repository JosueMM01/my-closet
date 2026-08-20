import { processedImageUploadSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import { getImageStorage, ImageOwnershipError } from '@/server/images/storage';
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
  const width = form.get('width');
  const height = form.get('height');
  const file = form.get('file');
  if (!(file instanceof File)) return invalidBody('Falta el archivo');
  const mime = file.type || 'application/octet-stream';
  const metadata = processedImageUploadSchema.safeParse({
    id,
    width,
    height,
    mimeType: mime,
    byteSize: file.size,
  });
  if (!metadata.success) return invalidBody('Metadatos de imagen inválidos');

  const data = Buffer.from(await file.arrayBuffer());
  if (!isWebp(data)) return jsonError(415, 'El archivo no es WebP válido');
  const storage = getImageStorage();
  try {
    const image = await storage.put({
      id: metadata.data.id,
      userId: user.userId,
      data,
      mimeType: metadata.data.mimeType,
      width: metadata.data.width,
      height: metadata.data.height,
    });
    return jsonOk({ image }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageOwnershipError) {
      return jsonError(409, 'El identificador de imagen ya está en uso');
    }
    throw error;
  }
}

function isWebp(data: Buffer): boolean {
  return data.byteLength >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP';
}
