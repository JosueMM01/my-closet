import { jsonError, jsonOk } from '@/server/http';
import { getPublicGarment, getPublicOutfit } from '@/server/repositories/sync-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lectura pública por shareableId (enlace de compartir sin login).
 * No expone datos del propietario más allá del contenido compartido.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; shareableId: string }> },
) {
  const { type, shareableId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(shareableId)) {
    return jsonError(400, 'id inválido');
  }

  if (type === 'garment') {
    const garment = await getPublicGarment(shareableId);
    if (!garment) return jsonError(404, 'Prenda no encontrada');
    return jsonOk({ type, garment });
  }
  if (type === 'outfit') {
    const outfit = await getPublicOutfit(shareableId);
    if (!outfit) return jsonError(404, 'Outfit no encontrado');
    return jsonOk({ type, outfit });
  }
  return jsonError(400, 'Tipo no soportado');
}
