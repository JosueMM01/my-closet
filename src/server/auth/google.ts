import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';
import type { GoogleAuthConfig } from '@/server/env';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  id_token: z.string().min(1).max(16_384),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  refresh_token: z.string().optional(),
});

const googleIdentitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(120),
  email_verified: z.literal(true),
  nonce: z.string().min(32).max(128),
  exp: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  picture: z.url().max(2_048).optional(),
});

export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string | null;
  pictureUrl: string | null;
}

export interface GoogleOAuthDependencies {
  fetch: typeof fetch;
  jwks: JWTVerifyGetKey;
}

let remoteJwks: JWTVerifyGetKey | null = null;

function getRemoteJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_ENDPOINT), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return remoteJwks;
}

export function createGoogleOAuthValues(): {
  state: string;
  verifier: string;
  challenge: string;
  nonce: string;
} {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state, verifier, challenge, nonce };
}

export function buildGoogleAuthorizationUrl(input: {
  config: GoogleAuthConfig;
  state: string;
  challenge: string;
  nonce: string;
}): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.config.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url;
}

export async function exchangeGoogleCode(input: {
  code: string;
  verifier: string;
  config: GoogleAuthConfig;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.callbackUrl,
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Google token exchange failed');
  const parsed = googleTokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error('Invalid Google token response');
  return parsed.data.id_token;
}

export async function verifyGoogleIdToken(input: {
  idToken: string;
  expectedNonce: string;
  clientId: string;
  jwks?: JWTVerifyGetKey;
}): Promise<GoogleIdentity> {
  const verified = await jwtVerify(input.idToken, input.jwks ?? getRemoteJwks(), {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: input.clientId,
    requiredClaims: ['sub', 'email', 'email_verified', 'nonce', 'exp'],
  });
  const identity = googleIdentitySchema.safeParse(verified.payload);
  if (!identity.success || identity.data.nonce !== input.expectedNonce) {
    throw new Error('Invalid Google identity');
  }
  return {
    subject: identity.data.sub,
    email: identity.data.email.trim().toLowerCase(),
    displayName: identity.data.name ?? null,
    pictureUrl: identity.data.picture ?? null,
  };
}

export async function getGoogleIdentityFromCode(input: {
  code: string;
  verifier: string;
  expectedNonce: string;
  config: GoogleAuthConfig;
  dependencies?: GoogleOAuthDependencies;
}): Promise<GoogleIdentity> {
  const idToken = await exchangeGoogleCode({
    code: input.code,
    verifier: input.verifier,
    config: input.config,
    fetchImpl: input.dependencies?.fetch,
  });
  return verifyGoogleIdToken({
    idToken,
    expectedNonce: input.expectedNonce,
    clientId: input.config.clientId,
    jwks: input.dependencies?.jwks,
  });
}
