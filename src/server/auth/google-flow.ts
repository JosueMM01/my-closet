import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuthSecret, isProduction } from '@/server/env';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const GOOGLE_FLOW_COOKIES = {
  state: 'mc_google_state',
  verifier: 'mc_google_verifier',
  nonce: 'mc_google_nonce',
  intent: 'mc_google_intent',
  linkUser: 'mc_google_link_user',
  invitation: 'mc_google_invitation',
} as const;

export const GOOGLE_PICTURE_COOKIE = 'mc_google_picture';
export type GoogleFlowIntent = 'login' | 'link' | 'invite' | 'photo';

function googleCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/api/auth/google',
    maxAge,
  };
}

export function setGoogleFlowCookies(
  store: CookieStore,
  input: {
    state: string;
    verifier: string;
    nonce: string;
    intent: GoogleFlowIntent;
    linkUserId?: string;
    invitationToken?: string;
  },
): void {
  const cookieOptions = googleCookieOptions(10 * 60);
  store.set(GOOGLE_FLOW_COOKIES.state, input.state, cookieOptions);
  store.set(GOOGLE_FLOW_COOKIES.verifier, input.verifier, cookieOptions);
  store.set(GOOGLE_FLOW_COOKIES.nonce, input.nonce, cookieOptions);
  store.set(GOOGLE_FLOW_COOKIES.intent, input.intent, cookieOptions);
  if (input.linkUserId) {
    store.set(GOOGLE_FLOW_COOKIES.linkUser, input.linkUserId, cookieOptions);
  } else {
    store.delete(GOOGLE_FLOW_COOKIES.linkUser);
  }
  if (input.invitationToken) {
    const signature = createHmac('sha256', getAuthSecret())
      .update(`${input.state}.${input.invitationToken}`)
      .digest('base64url');
    store.set(
      GOOGLE_FLOW_COOKIES.invitation,
      `${input.invitationToken}.${signature}`,
      cookieOptions,
    );
  } else {
    store.delete(GOOGLE_FLOW_COOKIES.invitation);
  }
}

export function clearGoogleFlowCookies(store: CookieStore): void {
  for (const name of Object.values(GOOGLE_FLOW_COOKIES)) {
    store.set(name, '', googleCookieOptions(0));
  }
}

export function safeStateEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function readGoogleInvitationToken(
  store: CookieStore,
  state: string,
): string | null {
  const value = store.get(GOOGLE_FLOW_COOKIES.invitation)?.value;
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac('sha256', getAuthSecret())
    .update(`${state}.${token}`)
    .digest('base64url');
  return safeStateEqual(signature, expected) ? token : null;
}

function isAllowedGooglePictureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))
    );
  } catch {
    return false;
  }
}

export function setGooglePictureCookie(
  store: CookieStore,
  input: { userId: string; pictureUrl: string | null },
): void {
  if (!input.pictureUrl || !isAllowedGooglePictureUrl(input.pictureUrl)) {
    clearGooglePictureCookie(store);
    return;
  }
  const payload = Buffer.from(JSON.stringify({
    userId: input.userId,
    pictureUrl: input.pictureUrl,
    expiresAt: Date.now() + 10 * 60_000,
  })).toString('base64url');
  const signature = createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  store.set(GOOGLE_PICTURE_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/api/profile/google/picture',
    maxAge: 10 * 60,
  });
}

export function readGooglePictureCookie(
  store: CookieStore,
): { userId: string; pictureUrl: string } | null {
  const value = store.get(GOOGLE_PICTURE_COOKIE)?.value;
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  if (!safeStateEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: unknown;
      pictureUrl?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.pictureUrl !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now() ||
      !isAllowedGooglePictureUrl(parsed.pictureUrl)
    ) return null;
    return { userId: parsed.userId, pictureUrl: parsed.pictureUrl };
  } catch {
    return null;
  }
}

export function clearGooglePictureCookie(store: CookieStore): void {
  store.set(GOOGLE_PICTURE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/api/profile/google/picture',
    maxAge: 0,
  });
}
