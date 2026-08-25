import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getGoogleIdentityFromCode } from '@/server/auth/google';
import {
  clearGoogleFlowCookies,
  GOOGLE_FLOW_COOKIES,
  readGoogleInvitationToken,
  safeStateEqual,
  setGooglePictureCookie,
  type GoogleFlowIntent,
} from '@/server/auth/google-flow';
import { hashPassword } from '@/server/auth/password';
import { createSession, getSessionUser } from '@/server/auth/session';
import { getGoogleAuthConfig, type GoogleAuthConfig } from '@/server/env';
import {
  findActiveUserByGoogleSubject,
  findGoogleAccountByUserId,
  linkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import {
  AccountError,
  registerInvitedGoogleAccount,
} from '@/server/repositories/users-repository';

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

function failurePath(intent: string | undefined, invitationToken: string | null, reason = 'denied'): string {
  if (intent === 'link' || intent === 'photo') return `/profile?google=${reason}`;
  if (intent === 'invite') {
    const fragment = invitationToken ? `#invite=${encodeURIComponent(invitationToken)}` : '';
    return `/register?google=${reason}${fragment}`;
  }
  return '/login?google=denied';
}

export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const storedIntent = store.get(GOOGLE_FLOW_COOKIES.intent)?.value as GoogleFlowIntent | undefined;
  let config: GoogleAuthConfig | null = null;
  let invitationToken: string | null = null;

  try {
    config = getGoogleAuthConfig();
    if (!config) return redirectTo(request, failurePath(storedIntent, null));
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
      return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
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
      !storedIntent ||
      !(['login', 'link', 'invite', 'photo'] as const).includes(storedIntent) ||
      !safeStateEqual(query.data.state, expectedState)
    ) {
      return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
    }

    if (storedIntent === 'invite') {
      invitationToken = readGoogleInvitationToken(store, expectedState);
      if (!invitationToken) {
        return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
      }
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
        return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
      }
      await linkGoogleAccount({
        userId: principal.userId,
        providerSubject: identity.subject,
        providerEmail: identity.email,
      });
      setGooglePictureCookie(store, { userId: principal.userId, pictureUrl: identity.pictureUrl });
      return redirectTo(
        request,
        identity.pictureUrl ? '/profile?google=linked&googlePicture=available' : '/profile?google=linked',
        config.appUrl,
      );
    }

    if (storedIntent === 'photo') {
      const storedLinkUser = store.get(GOOGLE_FLOW_COOKIES.linkUser)?.value;
      const principal = await getSessionUser();
      const account = principal ? await findGoogleAccountByUserId(principal.userId) : null;
      if (
        !principal ||
        !storedLinkUser ||
        principal.userId !== storedLinkUser ||
        account?.providerSubject !== identity.subject ||
        account.providerEmail !== identity.email
      ) {
        return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
      }
      setGooglePictureCookie(store, { userId: principal.userId, pictureUrl: identity.pictureUrl });
      return redirectTo(
        request,
        identity.pictureUrl ? '/profile?google=picture&googlePicture=available' : '/profile?google=picture-missing',
        config.appUrl,
      );
    }

    if (storedIntent === 'invite' && invitationToken) {
      const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
      const user = await registerInvitedGoogleAccount({
        invitationToken,
        providerSubject: identity.subject,
        providerEmail: identity.email,
        displayName: identity.displayName ?? identity.email.split('@')[0] ?? 'Usuario',
        passwordHash,
      });
      await createSession(user.id);
      setGooglePictureCookie(store, { userId: user.id, pictureUrl: identity.pictureUrl });
      return redirectTo(
        request,
        identity.pictureUrl ? '/profile?google=invited&googlePicture=auto' : '/profile?google=invited',
        config.appUrl,
      );
    }

    const user = await findActiveUserByGoogleSubject(identity.subject);
    if (!user) return redirectTo(request, failurePath(storedIntent, null), config.appUrl);
    await createSession(user.id);
    return redirectTo(request, '/', config.appUrl);
  } catch (error) {
    const reason = error instanceof AccountError && error.code === 'INVITATION_EMAIL_MISMATCH'
      ? 'email-mismatch'
      : 'denied';
    return redirectTo(request, failurePath(storedIntent, invitationToken, reason), config?.appUrl);
  } finally {
    clearGoogleFlowCookies(store);
  }
}
