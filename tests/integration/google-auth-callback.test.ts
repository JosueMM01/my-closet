import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeServerDB } from '@/server/db';
import { createSession } from '@/server/auth/session';
import {
  findGoogleAccountByUserId,
  linkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import { createUser } from '@/server/repositories/users-repository';
import { getSqlite, sqliteSchema } from '@/server/db';
import { eq } from 'drizzle-orm';

const cookieState = vi.hoisted(() => new Map<string, string>());
const getGoogleIdentityFromCode = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) cookieState.delete(name);
      else cookieState.set(name, value);
    },
    delete: (name: string) => cookieState.delete(name),
  }),
}));

vi.mock('@/server/auth/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/google')>()),
  getGoogleIdentityFromCode,
}));

import { GET as callback } from '@/app/api/auth/google/callback/route';
import { GET as start } from '@/app/api/auth/google/start/route';
import {
  DELETE as unlinkGoogle,
  GET as getGoogleStatus,
} from '@/app/api/profile/google/route';
import { googleLinkStatusResponseSchema } from '@/lib/domain/validation';
import { GOOGLE_FLOW_COOKIES } from '@/server/auth/google-flow';

function setFlow(intent: 'login' | 'link', userId?: string): void {
  cookieState.set(GOOGLE_FLOW_COOKIES.state, 'state-value-with-at-least-thirty-two-bytes');
  cookieState.set(GOOGLE_FLOW_COOKIES.verifier, 'verifier-value');
  cookieState.set(GOOGLE_FLOW_COOKIES.nonce, 'nonce-value-with-at-least-thirty-two-bytes');
  cookieState.set(GOOGLE_FLOW_COOKIES.intent, intent);
  if (userId) cookieState.set(GOOGLE_FLOW_COOKIES.linkUser, userId);
}

function callbackRequest(state = 'state-value-with-at-least-thirty-two-bytes'): Request {
  return new Request(`http://localhost/api/auth/google/callback?code=one-time-code&state=${state}`);
}

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
  process.env.GOOGLE_AUTH_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  cookieState.clear();
  getGoogleIdentityFromCode.mockReset();
  await closeServerDB();
});

afterEach(closeServerDB);

describe('callback de Google', () => {
  it('inicia login con cookies transitorias y parámetros OAuth estrictos', async () => {
    const response = await start(
      new Request('http://localhost/api/auth/google/start?intent=login'),
    );
    const location = new URL(response.headers.get('location') ?? '');

    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBe(cookieState.get(GOOGLE_FLOW_COOKIES.state));
    expect(location.searchParams.get('nonce')).toBe(cookieState.get(GOOGLE_FLOW_COOKIES.nonce));
    expect(location.toString()).not.toContain('client-secret');
  });

  it('exige una sesión activa para iniciar la vinculación', async () => {
    const response = await start(
      new Request('http://localhost/api/auth/google/start?intent=link'),
    );
    expect(response.status).toBe(401);
    expect(getGoogleIdentityFromCode).not.toHaveBeenCalled();
  });

  it('rechaza state incorrecto sin intercambiar el código y limpia cookies', async () => {
    setFlow('login');
    const response = await callback(callbackRequest('wrong-state-value-with-at-least-thirty-two'));

    expect(response.headers.get('location')).toBe('http://localhost/login?google=denied');
    expect(getGoogleIdentityFromCode).not.toHaveBeenCalled();
    expect([...cookieState.keys()].filter((key) => key.startsWith('mc_google_'))).toEqual([]);
  });

  it('deniega login no vinculado con un mensaje genérico', async () => {
    setFlow('login');
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'unlinked-subject',
      email: 'person@example.test',
    });
    const response = await callback(callbackRequest());

    expect(response.headers.get('location')).toBe('http://localhost/login?google=denied');
    expect(response.headers.get('location')).not.toContain('unlinked-subject');
  });

  it('inicia sesión solo para una cuenta ya vinculada y activa', async () => {
    const user = await createUser({
      email: 'login@example.test',
      displayName: 'Login',
      passwordHash: 'password-hash',
    });
    await linkGoogleAccount({
      userId: user.id,
      providerSubject: 'login-subject',
      providerEmail: user.email,
    });
    setFlow('login');
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'login-subject',
      email: user.email,
    });

    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toBe('http://localhost/');
    expect(cookieState.has('mc_session')).toBe(true);
  });

  it('deniega una cuenta vinculada que fue deshabilitada', async () => {
    const user = await createUser({
      email: 'disabled@example.test',
      displayName: 'Disabled',
      passwordHash: 'password-hash',
    });
    await linkGoogleAccount({
      userId: user.id,
      providerSubject: 'disabled-subject',
      providerEmail: user.email,
    });
    const sqlite = await getSqlite();
    await sqlite
      .update(sqliteSchema.users)
      .set({ status: 'DISABLED' })
      .where(eq(sqliteSchema.users.id, user.id));
    setFlow('login');
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'disabled-subject',
      email: user.email,
    });

    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toBe('http://localhost/login?google=denied');
    expect(cookieState.has('mc_session')).toBe(false);
  });

  it('vincula solo el correo normalizado exacto de la sesión activa', async () => {
    const user = await createUser({
      email: 'person@example.test',
      displayName: 'Person',
      passwordHash: 'password-hash',
    });
    await createSession(user.id);
    setFlow('link', user.id);
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'linked-subject',
      email: 'PERSON@EXAMPLE.TEST',
    });
    const response = await callback(callbackRequest());

    expect(response.headers.get('location')).toBe('http://localhost/profile?google=linked');
    await expect(findGoogleAccountByUserId(user.id)).resolves.toMatchObject({
      providerSubject: 'linked-subject',
      providerEmail: 'person@example.test',
    });

    const status = googleLinkStatusResponseSchema.parse(await (await getGoogleStatus()).json());
    expect(status).toEqual({ linked: true, providerEmail: 'person@example.test' });
    expect(
      (await unlinkGoogle(new Request('http://localhost/api/profile/google', { method: 'DELETE' })))
        .status,
    ).toBe(200);
    await expect(findGoogleAccountByUserId(user.id)).resolves.toBeNull();
  });

  it('deniega la vinculación cuando el correo verificado no coincide', async () => {
    const user = await createUser({
      email: 'person@example.test',
      displayName: 'Person',
      passwordHash: 'password-hash',
    });
    await createSession(user.id);
    setFlow('link', user.id);
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'wrong-email-subject',
      email: 'other@example.test',
    });
    const response = await callback(callbackRequest());

    expect(response.headers.get('location')).toBe('http://localhost/profile?google=denied');
    await expect(findGoogleAccountByUserId(user.id)).resolves.toBeNull();
  });
});
