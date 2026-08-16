import { isGoogleEnabled } from '@/server/env';
import { jsonOk } from '@/server/http';

export const runtime = 'nodejs';

/** Proveedores de login disponibles según variables de entorno. */
export async function GET() {
  return jsonOk({
    credentials: true,
    google: isGoogleEnabled(),
  });
}
