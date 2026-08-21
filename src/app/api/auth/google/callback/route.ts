import { cookies } from 'next/headers';
import { z } from 'zod';
import { getGoogleIdentityFromCode } from '@/server/auth/google';
import {
  clearGoogleFlowCookies,
  GOOGLE_FLOW_COOKIES,
  safeStateEqual,
} from '@/server/auth/google-flow';
import { createSession, getSessionUser } from '@/server/auth/session';
import { getGoogleAuthConfig, type GoogleAuthConfig } from '@/server/env';
import {
  findActiveUserByGoogleSubject,
  linkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const callbackQuerySchema = z
  .object({
    code: z.string().min(1).max(4096).optional(),
    state: z.string().min(32).max(128),
    error: z.string().min(1).max(128).optional(),
    error_description: z.string().max(1024).optional(),
    scope: z.string().max(1024).optional(),
    authuser: z.string().max(32).optional(),
    prompt: z.string().max(128).optional(),
    hd: z.string().max(255).optional(),
    iss: z.string().max(255).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.code) !== Boolean(value.error));

function redirectTo(request: Request, path: string, configAppUrl?: string): Response {
  const location = new URL(path, configAppUrl ?? request.url);
  return new Response(null, {
    status: 303,
    headers: { location: location.toString(), 'cache-control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const storedIntent = store.get(GOOGLE_FLOW_COOKIES.intent)?.value;
  const failurePath = storedIntent === 'link' ? '/profile?google=denied' : '/login?google=denied';
  let config: GoogleAuthConfig | null = null;

  try {
    config = getGoogleAuthConfig();
    if (!config) return redirectTo(request, failurePath);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
      return redirectTo(request, failurePath, config.appUrl);
    }
    const query = callbackQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    const expectedState = store.get(GOOGLE_FLOW_COOKIES.state)?.value;
    const verifier = store.get(GOOGLE_FLOW_COOKIES.verifier)?.value;
    const nonce = store.get(GOOGLE_FLOW_COOKIES.nonce)?.value;
    if (
      !query.success ||
      query.data.error ||
      !query.data.code ||
      !expectedState ||
      !verifier ||
      !nonce ||
      (storedIntent !== 'login' && storedIntent !== 'link') ||
      !safeStateEqual(query.data.state, expectedState)
    ) {
      return redirectTo(request, failurePath, config.appUrl);
    }

    const identity = await getGoogleIdentityFromCode({
      code: query.data.code,
      verifier,
      expectedNonce: nonce,
      config,
    });

    if (storedIntent === 'link') {
      const storedLinkUser = store.get(GOOGLE_FLOW_COOKIES.linkUser)?.value;
      const principal = await getSessionUser();
      if (!principal || !storedLinkUser || principal.userId !== storedLinkUser) {
        return redirectTo(request, failurePath, config.appUrl);
      }
      await linkGoogleAccount({
        userId: principal.userId,
        providerSubject: identity.subject,
        providerEmail: identity.email,
      });
      return redirectTo(request, '/profile?google=linked', config.appUrl);
    }

    const user = await findActiveUserByGoogleSubject(identity.subject);
    if (!user) return redirectTo(request, failurePath, config.appUrl);
    await createSession(user.id);
    return redirectTo(request, '/', config.appUrl);
  } catch {
    return redirectTo(request, failurePath, config?.appUrl);
  } finally {
    clearGoogleFlowCookies(store);
  }
}
