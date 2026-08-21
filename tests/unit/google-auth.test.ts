import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthValues,
  getGoogleIdentityFromCode,
  verifyGoogleIdToken,
} from '@/server/auth/google';
import type { GoogleAuthConfig } from '@/server/env';

const config: GoogleAuthConfig = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  appUrl: 'https://closet.example.test',
  callbackUrl: 'https://closet.example.test/api/auth/google/callback',
};

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
});

async function token(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'google-subject',
    email: 'person@example.test',
    email_verified: true,
    nonce: 'expected-nonce-value-with-enough-length',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(config.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

describe('Google OAuth', () => {
  it('crea una autorización con state, PKCE y nonce sin exponer el secreto', () => {
    const values = createGoogleOAuthValues();
    const url = buildGoogleAuthorizationUrl({ config, ...values });

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe(values.state);
    expect(url.searchParams.get('nonce')).toBe(values.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(values.challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it('intercambia el código con fetch mock y verifica el ID token con JWKS mock', async () => {
    const idToken = await token();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id_token: idToken, token_type: 'Bearer', expires_in: 3600 }),
    );

    await expect(
      getGoogleIdentityFromCode({
        code: 'one-time-code',
        verifier: 'pkce-verifier',
        expectedNonce: 'expected-nonce-value-with-enough-length',
        config,
        dependencies: { fetch: fetchMock, jwks },
      }),
    ).resolves.toEqual({ subject: 'google-subject', email: 'person@example.test' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    expect(String(request?.body)).toContain('code_verifier=pkce-verifier');
  });

  it('rechaza nonce, audience y email no verificado', async () => {
    await expect(
      verifyGoogleIdToken({
        idToken: await token(),
        expectedNonce: 'different-nonce-value-with-enough-length',
        clientId: config.clientId,
        jwks,
      }),
    ).rejects.toThrow();
    await expect(
      verifyGoogleIdToken({
        idToken: await token(),
        expectedNonce: 'expected-nonce-value-with-enough-length',
        clientId: 'wrong-audience',
        jwks,
      }),
    ).rejects.toThrow();
    await expect(
      verifyGoogleIdToken({
        idToken: await token({ email_verified: false }),
        expectedNonce: 'expected-nonce-value-with-enough-length',
        clientId: config.clientId,
        jwks,
      }),
    ).rejects.toThrow();
  });
});
