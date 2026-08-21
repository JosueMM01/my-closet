import { cookies } from 'next/headers';
import { z } from 'zod';
import { buildGoogleAuthorizationUrl, createGoogleOAuthValues } from '@/server/auth/google';
import { setGoogleFlowCookies } from '@/server/auth/google-flow';
import { getSessionUser } from '@/server/auth/session';
import { getGoogleAuthConfig } from '@/server/env';
import { jsonError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startQuerySchema = z.object({ intent: z.enum(['login', 'link']) }).strict();

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = startQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success || url.searchParams.getAll('intent').length !== 1) {
    return jsonError(400, 'Solicitud de acceso no válida');
  }
  const config = getGoogleAuthConfig();
  if (!config) return jsonError(404, 'Acceso con Google no disponible');

  const principal = query.data.intent === 'link' ? await getSessionUser() : null;
  if (query.data.intent === 'link' && !principal) {
    return jsonError(401, 'No autenticado o sesión expirada');
  }

  const values = createGoogleOAuthValues();
  setGoogleFlowCookies(await cookies(), {
    ...values,
    intent: query.data.intent,
    linkUserId: principal?.userId,
  });
  const authorizationUrl = buildGoogleAuthorizationUrl({ config, ...values });
  return new Response(null, {
    status: 302,
    headers: { location: authorizationUrl.toString(), 'cache-control': 'no-store' },
  });
}
