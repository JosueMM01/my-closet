import { getImageStorage } from '@/server/images/storage';
import { jsonError } from '@/server/http';

export const runtime = 'nodejs';

/**
 * Sirve una imagen almacenada localmente (SQLite). El id es un UUID v4
 * aleatorio: inadivinable, sin enumeración. Público para que funcionen
 * los enlaces de compartir; el CDN de Cloudinary reemplazará esto en producción.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonError(400, 'id inválido');
  }
  const stored = await getImageStorage().get(id);
  if (!stored) {
    return jsonError(404, 'Imagen no encontrada');
  }
  return new Response(new Uint8Array(stored.data), {
    headers: {
      'content-type': stored.mimeType,
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
