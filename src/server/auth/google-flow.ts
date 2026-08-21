import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { isProduction } from '@/server/env';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const GOOGLE_FLOW_COOKIES = {
  state: 'mc_google_state',
  verifier: 'mc_google_verifier',
  nonce: 'mc_google_nonce',
  intent: 'mc_google_intent',
  linkUser: 'mc_google_link_user',
} as const;

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
    intent: 'login' | 'link';
    linkUserId?: string;
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
