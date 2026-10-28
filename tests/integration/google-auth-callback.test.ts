import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeServerDB } from '@/server/db';
import { createSession } from '@/server/auth/session';
import {
  findGoogleAccountByUserId,
  linkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import { createUser } from '@/server/repositories/users-repository';
import { createInvitation } from '@/server/repositories/invitations-repository';
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
import { GET as start, POST as startInvitation } from '@/app/api/auth/google/start/route';
import {
  DELETE as unlinkGoogle,
  GET as getGoogleStatus,
} from '@/app/api/profile/google/route';
import { GET as getGooglePicture } from '@/app/api/profile/google/picture/route';
import { googleLinkStatusResponseSchema } from '@/lib/domain/validation';
import { GOOGLE_FLOW_COOKIES } from '@/server/auth/google-flow';
import { DELETION_PROOF_COOKIE } from '@/server/auth/account-deletion';
import { hashPassword } from '@/server/auth/password';
import { GET as deletionStatus, DELETE as deleteSelf } from '@/app/api/profile/deletion/route';

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

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await closeServerDB();
});

describe('callback de Google', () => {
  it('la baja con contraseña exige confirmación, origen propio y contraseña correcta', async () => {
    vi.stubEnv('ACCOUNT_DELETION_ENABLED', 'true');
    const user = await createUser({ email: 'delete-password@example.test', displayName: 'Sintético', passwordHash: await hashPassword('synthetic-valid-password') });
    await createSession(user.id);
    const request = (body: unknown, origin?: string) => new Request('http://localhost/api/profile/deletion', {
      method: 'DELETE', headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet', ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
    });
    expect((await deleteSelf(request({ acknowledge: false, currentPassword: 'synthetic-valid-password' }))).status).toBe(400);
    expect((await deleteSelf(request({ acknowledge: true, currentPassword: 'synthetic-valid-password' }, 'https://foreign.example.test'))).status).toBe(403);
    expect((await deleteSelf(request({ acknowledge: true, currentPassword: 'wrong-password' }))).status).toBe(403);
    expect((await deleteSelf(request({ acknowledge: true, userId: 'other-user', currentPassword: 'synthetic-valid-password' }))).status).toBe(400);
    expect((await getSqlite()).select().from(sqliteSchema.users).get()?.status).toBe('ACTIVE');
    expect((await deleteSelf(request({ acknowledge: true, currentPassword: 'synthetic-valid-password' }))).status).toBe(202);
    expect((await getSqlite()).select().from(sqliteSchema.users).get()?.status).toBe('DISABLED');
  });
  it.each([undefined, Math.floor(Date.now() / 1000) - 3600])('no autoriza una baja con auth_time ausente o antiguo: %s', async authenticatedAt => {
    vi.stubEnv('ACCOUNT_DELETION_ENABLED', 'true');
    const user = await createUser({ email: 'delete-google@example.test', displayName: 'Sintético', passwordHash: 'google-only-unusable' });
    await linkGoogleAccount({ userId: user.id, providerSubject: 'delete-google-subject', providerEmail: user.email });
    await createSession(user.id);
    await start(new Request('http://localhost/api/auth/google/start?intent=delete'));
    getGoogleIdentityFromCode.mockResolvedValue({ subject: 'delete-google-subject', email: user.email, authenticatedAt });
    const result = await callback(callbackRequest(cookieState.get(GOOGLE_FLOW_COOKIES.state)));
    expect(result.headers.get('location')).toContain('reauth-required');
    expect(cookieState.has(DELETION_PROOF_COOKIE)).toBe(false);
    expect((await getSqlite()).select().from(sqliteSchema.users).get()?.status).toBe('ACTIVE');
  });
  it('confirma Google sin borrar en el callback; exige un DELETE explícito y consume la prueba', async () => {
    vi.stubEnv('ACCOUNT_DELETION_ENABLED', 'true');
    const user = await createUser({ email: 'delete-google@example.test', displayName: 'Sintético', passwordHash: 'google-only-unusable' });
    await linkGoogleAccount({ userId: user.id, providerSubject: 'delete-google-subject', providerEmail: user.email });
    await createSession(user.id);
    const started = await start(new Request('http://localhost/api/auth/google/start?intent=delete'));
    const authorization = new URL(started.headers.get('location')!);
    expect(authorization.searchParams.get('max_age')).toBe('0');
    expect(JSON.parse(authorization.searchParams.get('claims')!)).toEqual({ id_token: { auth_time: { essential: true } } });
    getGoogleIdentityFromCode.mockResolvedValue({ subject: 'delete-google-subject', email: user.email, authenticatedAt: Math.floor(Date.now() / 1000) });
    const result = await callback(callbackRequest(cookieState.get(GOOGLE_FLOW_COOKIES.state)));
    expect(result.headers.get('location')).toBe('http://localhost/profile#delete-account');
    expect(cookieState.has(DELETION_PROOF_COOKIE)).toBe(true);
    expect((await getSqlite()).select().from(sqliteSchema.users).get()?.status).toBe('ACTIVE');
    expect(await (await deletionStatus()).json()).toMatchObject({ enabled: true, reauthenticated: true });
    const deleted = await deleteSelf(new Request('http://localhost/api/profile/deletion', {
      method: 'DELETE', headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' }, body: JSON.stringify({ acknowledge: true }),
    }));
    expect(deleted.status).toBe(202);
    expect(cookieState.has(DELETION_PROOF_COOKIE)).toBe(false);
    expect(cookieState.has('mc_session')).toBe(false);
    expect((await getSqlite()).select().from(sqliteSchema.users).get()?.status).toBe('DISABLED');
  });
  it('rechaza otra identidad de Google aunque el correo y auth_time coincidan', async () => {
    vi.stubEnv('ACCOUNT_DELETION_ENABLED', 'true');
    const user = await createUser({ email: 'delete-google@example.test', displayName: 'Sintético', passwordHash: 'google-only-unusable' });
    await linkGoogleAccount({ userId: user.id, providerSubject: 'expected-subject', providerEmail: user.email });
    await createSession(user.id);
    await start(new Request('http://localhost/api/auth/google/start?intent=delete'));
    getGoogleIdentityFromCode.mockResolvedValue({ subject: 'different-subject', email: user.email, authenticatedAt: Math.floor(Date.now() / 1000) });
    expect((await callback(callbackRequest(cookieState.get(GOOGLE_FLOW_COOKIES.state)))).headers.get('location')).toContain('reauth-required');
    expect(cookieState.has(DELETION_PROOF_COOKIE)).toBe(false);
  });
  it('rechaza formularios, JSON malformado y orígenes ajenos antes de crear cookies', async () => {
    const form = new FormData();
    form.set('invitationToken', 't'.repeat(43));
    const rejectedForm = await startInvitation(new Request('http://localhost/api/auth/google/start', {
      method: 'POST', body: form,
    }));
    expect(rejectedForm.status).toBe(400);
    const invalidJson = await startInvitation(new Request('http://localhost/api/auth/google/start', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' }, body: '{',
    }));
    expect(invalidJson.status).toBe(400);
    const foreign = await startInvitation(new Request('http://localhost/api/auth/google/start', {
      method: 'POST', headers: { origin: 'https://other.example', host: 'localhost',
        'content-type': 'application/json', 'x-requested-with': 'my-closet' },
      body: JSON.stringify({ invitationToken: 't'.repeat(43) }),
    }));
    expect(foreign.status).toBe(403);
    const unavailable = await startInvitation(new Request('http://localhost/api/auth/google/start', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' },
      body: JSON.stringify({ invitationToken: 't'.repeat(43) }),
    }));
    expect(unavailable.status).toBe(410);
    expect(cookieState.size).toBe(0);
  });
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

    expect(response.headers.get('location')).toBe('http://localhost/login?google=session-invalid');
    expect(getGoogleIdentityFromCode).not.toHaveBeenCalled();
    expect([...cookieState.keys()].filter((key) => key.startsWith('mc_google_'))).toEqual([]);
  });

  it('explica que no hay cuenta activa vinculada después de verificar Google', async () => {
    setFlow('login');
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'unlinked-subject',
      email: 'person@example.test',
    });
    const response = await callback(callbackRequest());

    expect(response.headers.get('location')).toBe('http://localhost/login?google=account-unavailable');
    expect(response.headers.get('location')).not.toContain('unlinked-subject');
    expect(response.headers.get('location')).not.toContain('person@example.test');
    expect(cookieState.has('mc_session')).toBe(false);
  });

  it('no vincula por coincidencia de correo aunque la cuenta ya exista', async () => {
    await createUser({ email: 'existing@example.test', displayName: 'Existente', passwordHash: 'fixture-hash' });
    setFlow('login');
    getGoogleIdentityFromCode.mockResolvedValue({ subject: 'not-linked', email: 'existing@example.test' });
    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toBe('http://localhost/login?google=account-unavailable');
    expect(cookieState.has('mc_session')).toBe(false);
  });

  it('distingue cancelación sin intercambiar código ni crear sesión', async () => {
    setFlow('login');
    const response = await callback(new Request('http://localhost/api/auth/google/callback?error=access_denied&state=state-value-with-at-least-thirty-two-bytes'));
    expect(response.headers.get('location')).toBe('http://localhost/login?google=cancelled');
    expect(getGoogleIdentityFromCode).not.toHaveBeenCalled();
    expect(cookieState.has('mc_session')).toBe(false);
    expect([...cookieState.keys()].filter((key) => key.startsWith('mc_google_'))).toEqual([]);
  });

  it('oculta detalles internos cuando Google no puede verificarse', async () => {
    setFlow('login');
    getGoogleIdentityFromCode.mockRejectedValue(new Error('raw-sensitive-fixture'));
    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toBe('http://localhost/login?google=denied');
    expect(response.headers.get('location')).not.toContain('raw-sensitive-fixture');
    expect(cookieState.has('mc_session')).toBe(false);
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

  it('regresa a una ruta interna tras Google y rechaza retornos externos', async () => {
    const invalidStart = await start(new Request(
      'http://localhost/api/auth/google/start?intent=login&returnTo=https%3A%2F%2Fevil.example',
    ));
    expect(invalidStart.status).toBe(400);

    const user = await createUser({
      email: 'return@example.test',
      displayName: 'Return',
      passwordHash: 'password-hash',
    });
    await linkGoogleAccount({
      userId: user.id,
      providerSubject: 'return-subject',
      providerEmail: user.email,
    });
    const started = await start(new Request(
      'http://localhost/api/auth/google/start?intent=login&returnTo=%2Fshare%2Fwardrobe%2Fabcdef0123456789abcdef0123456789',
    ));
    expect(started.status).toBe(302);
    expect(cookieState.get(GOOGLE_FLOW_COOKIES.returnTo))
      .toBe('/share/wardrobe/abcdef0123456789abcdef0123456789');
    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'return-subject',
      email: user.email,
    });

    const response = await callback(callbackRequest(cookieState.get(GOOGLE_FLOW_COOKIES.state)));
    expect(response.headers.get('location'))
      .toBe('http://localhost/share/wardrobe/abcdef0123456789abcdef0123456789');
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
    expect(response.headers.get('location')).toBe('http://localhost/login?google=account-unavailable');
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

    expect(response.headers.get('location')).toBe('http://localhost/profile?google=email-mismatch');
    await expect(findGoogleAccountByUserId(user.id)).resolves.toBeNull();
  });

  it('acepta una invitación con Google de forma atómica y crea la sesión', async () => {
    const admin = await createUser({
      email: 'admin@example.test',
      displayName: 'Admin',
      passwordHash: 'password-hash',
    });
    const sqlite = await getSqlite();
    await sqlite.update(sqliteSchema.users).set({ role: 'ADMIN', adminSlot: 1 })
      .where(eq(sqliteSchema.users.id, admin.id));
    const created = await createInvitation({
      actorId: admin.id,
      email: 'invite-google@example.test',
      role: 'USER',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const started = await startInvitation(new Request('http://localhost/api/auth/google/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' },
      body: JSON.stringify({ invitationToken: created.token }),
    }));
    expect(started.status).toBe(200);
    expect(started.headers.get('location')).toBeNull();
    expect(started.headers.get('cache-control')).toBe('no-store');
    const { authorizationUrl } = await started.json();
    expect(new URL(authorizationUrl).origin).toBe('https://accounts.google.com');
    expect(authorizationUrl).not.toContain(created.token);
    expect(cookieState.get(GOOGLE_FLOW_COOKIES.intent)).toBe('invite');

    getGoogleIdentityFromCode.mockResolvedValue({
      subject: 'invited-subject',
      email: 'INVITE-GOOGLE@EXAMPLE.TEST',
      displayName: 'Persona Google',
      pictureUrl: 'https://lh3.googleusercontent.com/profile-photo',
    });
    const response = await callback(callbackRequest(cookieState.get(GOOGLE_FLOW_COOKIES.state)));
    expect(response.headers.get('location')).toBe('http://localhost/profile?google=invited&googlePicture=auto');
    expect(cookieState.has('mc_session')).toBe(true);
    const account = sqlite.select().from(sqliteSchema.authAccounts).get();
    expect(account).toMatchObject({ providerSubject: 'invited-subject' });
    expect(sqlite.select().from(sqliteSchema.accountInvitations).get()).toMatchObject({
      acceptedBy: account?.userId,
      acceptedAt: expect.any(String),
    });

    expect(await (await getGooglePicture(
      new Request('http://localhost/api/profile/google/picture?mode=availability'),
    )).json()).toEqual({ available: true });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      }),
    ));
    const picture = await getGooglePicture(
      new Request('http://localhost/api/profile/google/picture?mode=content'),
    );
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/jpeg');
  });
});
