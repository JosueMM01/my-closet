import { cookies } from 'next/headers';
import { z } from 'zod';
import { googleInvitationStartSchema } from '@/lib/domain/validation';
import { buildGoogleAuthorizationUrl, createGoogleOAuthValues } from '@/server/auth/google';
import { setGoogleFlowCookies } from '@/server/auth/google-flow';
import { getSessionUser } from '@/server/auth/session';
import { guardRateLimit, requestRateLimitIdentity } from '@/server/auth/rate-limit';
import { getGoogleAuthConfig } from '@/server/env';
import { jsonError, requireSameOrigin } from '@/server/http';
import { inspectInvitationToken } from '@/server/repositories/invitations-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const safeReturnPathSchema = z
  .string()
  .max(512)
  .refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'));

const startQuerySchema = z.object({
  intent: z.enum(['login', 'link', 'photo']),
  returnTo: safeReturnPathSchema.optional(),
}).strict();

function oauthRedirect(config: NonNullable<ReturnType<typeof getGoogleAuthConfig>>, values: ReturnType<typeof createGoogleOAuthValues>): Response {
  const authorizationUrl = buildGoogleAuthorizationUrl({ config, ...values });
  return new Response(null, {
    status: 302,
    headers: { location: authorizationUrl.toString(), 'cache-control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = startQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success || url.searchParams.getAll('intent').length !== 1) {
    return jsonError(400, 'Solicitud de acceso no válida');
  }
  const config = getGoogleAuthConfig();
  if (!config) return jsonError(404, 'Acceso con Google no disponible');
  const limited = await guardRateLimit(`oauth-start:${requestRateLimitIdentity(request)}`, 30);
  if (limited) return limited;

  const requiresSession = query.data.intent === 'link' || query.data.intent === 'photo';
  const principal = requiresSession ? await getSessionUser() : null;
  if (requiresSession && !principal) {
    return jsonError(401, 'No autenticado o sesión expirada');
  }

  const values = createGoogleOAuthValues();
  setGoogleFlowCookies(await cookies(), {
    ...values,
    intent: query.data.intent,
    linkUserId: principal?.userId,
    returnTo: query.data.intent === 'login' ? query.data.returnTo : undefined,
  });
  return oauthRedirect(config, values);
}

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await guardRateLimit(`oauth-start:${requestRateLimitIdentity(request)}`, 30);
  if (limited) return limited;
  const config = getGoogleAuthConfig();
  if (!config) return jsonError(404, 'Acceso con Google no disponible');
  const formData = await request.formData().catch(() => null);
  const parsed = googleInvitationStartSchema.safeParse(
    formData ? Object.fromEntries(formData) : null,
  );
  if (!parsed.success) return jsonError(400, 'Invitación no válida');
  try {
    await inspectInvitationToken(parsed.data.invitationToken);
  } catch {
    return jsonError(410, 'La invitación no es válida o ha expirado');
  }
  const values = createGoogleOAuthValues();
  setGoogleFlowCookies(await cookies(), {
    ...values,
    intent: 'invite',
    invitationToken: parsed.data.invitationToken,
  });
  return oauthRedirect(config, values);
}
