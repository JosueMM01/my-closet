import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authResponseSchema,
  invitationCreatedResponseSchema,
  invitationsResponseSchema,
  sessionResponseSchema,
} from '@/lib/domain/validation';
import { closeServerDB, getServerDB, sqliteSchema } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { resetRateLimits } from '@/server/auth/rate-limit';
import {
  readCapturedMessagesForTests,
  resetCapturedMessagesForTests,
} from '@/server/mail/testing';
import { updateUserForAdmin } from '@/server/repositories/admin-users-repository';
import { findUserByEmail } from '@/server/repositories/users-repository';

const cookieState = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieState.set(name, value);
    },
    delete: (name: string) => {
      cookieState.delete(name);
    },
  }),
}));

import { GET as getAdminUsers } from '@/app/api/admin/users/route';
import {
  GET as getInvitations,
  POST as postInvitation,
} from '@/app/api/admin/invitations/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { GET as providers } from '@/app/api/auth/providers/route';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { GET as session } from '@/app/api/auth/session/route';
import { POST as changeEmail } from '@/app/api/profile/email/route';
import { POST as confirmEmail } from '@/app/api/profile/email/confirm/route';
import { consumeEmailChangeToken, EMAIL_CHANGE_MAX_ATTEMPTS, hashEmailChangeCode } from '@/server/repositories/email-change-repository';
import { requestEmailChange } from '@/server/services/email-change-service';
import { findUserById, updatePasswordHash } from '@/server/repositories/users-repository';
import { POST as changePassword } from '@/app/api/profile/password/route';

const BOOTSTRAP_EMAIL = 'api-bootstrap@example.test';
const BOOTSTRAP_PASSWORD = 'api-bootstrap-password';

function jsonRequest(url: string, body: unknown, ip = crypto.randomUUID()): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

async function registerUser(email: string, displayName: string) {
  const response = await register(
    jsonRequest('/api/auth/register', {
      email,
      displayName,
      password: 'contrasena-segura',
    }),
  );
  expect(response.status).toBe(201);
  return authResponseSchema.parse(await response.json()).profile;
}

async function loginBootstrap() {
  cookieState.clear();
  const response = await login(
    jsonRequest('/api/auth/login', {
      email: BOOTSTRAP_EMAIL,
      password: BOOTSTRAP_PASSWORD,
    }),
  );
  expect(response.status).toBe(200);
  return authResponseSchema.parse(await response.json()).profile;
}

function capturedResetToken(): string {
  const message = readCapturedMessagesForTests().find((candidate) =>
    candidate.subject.includes('Recupera tu contraseña'),
  );
  const token = message?.text.match(/\/reset-password#token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error('No se capturó el token de recuperación de prueba');
  return token;
}

function capturedEmailToken(): string {
  const message = readCapturedMessagesForTests().filter(candidate =>
    candidate.subject.includes('Confirma tu nuevo correo'),
  ).at(-1);
  const code = message?.text.match(/\n(\d(?:-\d){5})\n/)?.[1]?.replaceAll('-', '');
  if (!code) throw new Error('Falta código de verificación de prueba');
  return code;
}

beforeEach(async () => {
  vi.stubEnv('TURNSTILE_ENABLED', 'false');
  process.env.DATABASE_URL = 'file::memory:';
  process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
  process.env.BOOTSTRAP_ADMIN_EMAIL = BOOTSTRAP_EMAIL;
  process.env.BOOTSTRAP_ADMIN_PASSWORD = BOOTSTRAP_PASSWORD;
  process.env.EMAIL_PROVIDER = 'capture';
  cookieState.clear();
  await resetRateLimits();
  resetCapturedMessagesForTests();
  await closeServerDB();
});

afterEach(async () => {
  await closeServerDB();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('API de cuentas y perfil', () => {
  it('Turnstile obligatorio bloquea login antes de crear sesión y no revela claves', async () => {
    vi.stubEnv('TURNSTILE_ENABLED', 'true');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'synthetic-site');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'synthetic-secret');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await login(jsonRequest('/api/auth/login', { email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }));
    expect(response.status).toBe(403);
    expect(cookieState.size).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    const capabilities = await (await providers()).text();
    expect(capabilities).toContain('synthetic-site');
    expect(capabilities).not.toContain('synthetic-secret');
    const recovery = await forgotPassword(jsonRequest('/api/auth/forgot-password', { email: BOOTSTRAP_EMAIL }));
    expect(recovery.status).toBe(403);
    expect(readCapturedMessagesForTests()).toHaveLength(0);
    fetcher.mockResolvedValue(Response.json({ success: true, action: 'login', hostname: 'localhost' }));
    const verified = await login(jsonRequest('/api/auth/login', {
      email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD, turnstileToken: 'synthetic-token',
    }));
    expect(verified.status).toBe(200);
    expect(cookieState.size).toBeGreaterThan(0);
  });
  it('limita recuperaciones del mismo destinatario y conserva la respuesta genérica', async () => {
    const user = await registerUser('limited-mail@example.test', 'Correo');
    const responses = await Promise.all(Array.from({ length: 3 }, () => forgotPassword(
      jsonRequest('/api/auth/forgot-password', { email: user.email }),
    )));
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(readCapturedMessagesForTests().filter(message => message.subject.includes('Recupera'))).toHaveLength(1);
  });
  it.each([
    { route: '/api/profile/password', handler: changePassword, extra: { newPassword: 'nueva-contrasena-segura' } },
    { route: '/api/profile/email', handler: changeEmail, extra: { newEmail: 'destino@example.test' } },
  ])('limita comprobaciones de contraseña en $route sin modificar la cuenta', async ({ route, handler, extra }) => {
    const profile = await registerUser('limited-profile@example.test', 'Perfil');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Math.floor(Date.now() / 60_000) * 60_000 + 1000));
    try {
      const responses = await Promise.all(Array.from({ length: 6 }, () => handler(
        jsonRequest(route, { currentPassword: 'contrasena-incorrecta', ...extra }),
      )));
      expect(responses.filter(response => response.status === 403)).toHaveLength(5);
      expect(responses.filter(response => response.status === 429)).toHaveLength(1);
      const stored = await findUserByEmail(profile.email);
      expect(stored).toMatchObject({ email: profile.email });
      if (!stored) throw new Error('Falta la cuenta de prueba');
      expect(await verifyPassword('contrasena-segura', stored.passwordHash)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('anuncia registro público explícito y crea cuentas públicas como USER', async () => {
    const capabilities = await providers();
    expect(await capabilities.json()).toMatchObject({
      credentials: true,
      publicRegistration: true,
      invitationRegistration: true,
    });

    const profile = await registerUser('api-admin@example.test', 'API Admin');
    expect(profile).toMatchObject({ role: 'USER', status: 'ACTIVE', profileImageId: null });
    const activeSession = sessionResponseSchema.parse(await (await session()).json());
    expect(activeSession.authenticated).toBe(true);
  });

  it('valida contraseña actual, rota sesión y cambia correo sin perder acceso', async () => {
    const profile = await registerUser('perfil@example.test', 'Perfil');
    const wrong = await changePassword(
      jsonRequest('/api/profile/password', {
        currentPassword: 'incorrecta',
        newPassword: 'nueva-contrasena',
      }),
    );
    expect(wrong.status).toBe(403);

    const passwordResponse = await changePassword(
      jsonRequest('/api/profile/password', {
        currentPassword: 'contrasena-segura',
        newPassword: 'nueva-contrasena',
      }),
    );
    expect(passwordResponse.status).toBe(200);
    expect(sessionResponseSchema.parse(await (await session()).json()).authenticated).toBe(true);

    const emailResponse = await changeEmail(
      jsonRequest('/api/profile/email', {
        currentPassword: 'nueva-contrasena',
        newEmail: ' NUEVO-PERFIL@Example.Test ',
      }),
    );
    expect(emailResponse.status).toBe(200);
    expect(await emailResponse.json()).toEqual({ pending: true, email: 'nuevo-perfil@example.test' });
    const beforeConfirmation = sessionResponseSchema.parse(await (await session()).json());
    expect(beforeConfirmation.authenticated && beforeConfirmation.profile.email).toBe(profile.email);
    const previousCookie = new Map(cookieState);
    const token = capturedEmailToken();
    expect(token).toMatch(/^\d{6}$/);
    const confirmed = await confirmEmail(jsonRequest('/api/profile/email/confirm', { code: token }));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ email: 'nuevo-perfil@example.test' });
    const notice = readCapturedMessagesForTests().filter(candidate => candidate.subject.includes('cuenta de My Closet cambió')).at(-1);
    expect(notice?.to).toBe(profile.email);
    expect(notice?.text).toContain('n***@example.test');
    expect(notice?.text).not.toContain('nuevo-perfil');
    const current = sessionResponseSchema.parse(await (await session()).json());
    expect(current.authenticated && current.profile.email).toBe('nuevo-perfil@example.test');
    expect(await consumeEmailChangeToken(profile.userId, token)).toBeNull();
    cookieState.clear();
    for (const [key, value] of previousCookie) cookieState.set(key, value);
    expect(sessionResponseSchema.parse(await (await session()).json()).authenticated).toBe(false);

    cookieState.clear();
    const oldLogin = await login(
      jsonRequest('/api/auth/login', {
        email: profile.email,
        password: 'contrasena-segura',
      }),
    );
    expect(oldLogin.status).toBe(401);
    const nextLogin = await login(
      jsonRequest('/api/auth/login', {
        email: 'nuevo-perfil@example.test',
        password: 'nueva-contrasena',
      }),
    );
    expect(nextLogin.status).toBe(200);
  });

  it('no expone el código, no permite otra cuenta y reemplaza solicitudes anteriores', async () => {
    const owner = await registerUser('pending-owner@example.test', 'Titular');
    const first = await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'first-pending@example.test',
    }));
    expect(first.status).toBe(200);
    const firstToken = capturedEmailToken();
    expect(await first.text()).not.toContain(firstToken);
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Prueba SQLite');
    const [stored] = db.sqlite.select().from(sqliteSchema.emailChangeTokens).all();
    expect(stored?.tokenHash).toBe(hashEmailChangeCode(owner.userId, firstToken));
    expect(stored?.tokenHash).not.toContain(firstToken);
    expect(stored?.credentialHash).not.toContain('scrypt');
    expect(new Date(stored?.expiresAt ?? 0).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'second-pending@example.test',
    }));
    const secondToken = capturedEmailToken();
    if (firstToken !== secondToken) expect(await consumeEmailChangeToken(owner.userId, firstToken)).toBeNull();
    const other = await registerUser('other-pending@example.test', 'Otra cuenta');
    expect((await confirmEmail(jsonRequest('/api/profile/email/confirm', { code: secondToken }))).status).toBe(400);
    expect((await findUserById(other.userId))?.email).toBe(other.email);
    expect((await consumeEmailChangeToken(owner.userId, secondToken))?.newEmail).toBe('second-pending@example.test');
  });

  it('invalida el código tras el máximo de intentos fallidos', async () => {
    const profile = await registerUser('attempts-email@example.test', 'Intentos');
    await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'attempts-next@example.test',
    }));
    const code = capturedEmailToken();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < EMAIL_CHANGE_MAX_ATTEMPTS; attempt += 1) {
      expect(await consumeEmailChangeToken(profile.userId, wrong)).toBeNull();
    }
    expect(await consumeEmailChangeToken(profile.userId, code)).toBeNull();
    expect((await findUserById(profile.userId))?.email).toBe(profile.email);
  });

  it('rechaza caducidad y cambios posteriores de credenciales sin cambiar el correo', async () => {
    const profile = await registerUser('expiry-email@example.test', 'Caducidad');
    await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'expiry-next@example.test',
    }));
    const token = capturedEmailToken();
    expect(await consumeEmailChangeToken(profile.userId, token, new Date(Date.now() + 11 * 60_000))).toBeNull();
    await updatePasswordHash(profile.userId, 'scrypt:changed-after-request');
    expect(await consumeEmailChangeToken(profile.userId, token)).toBeNull();
    expect((await findUserById(profile.userId))?.email).toBe(profile.email);
  });

  it('resuelve conflictos de destino al confirmar sin consumir ni revocar sesiones', async () => {
    const owner = await registerUser('conflict-owner@example.test', 'Titular');
    await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'conflict-target@example.test',
    }));
    const token = capturedEmailToken();
    const other = await registerUser('conflict-target@example.test', 'Ocupante');
    await expect(consumeEmailChangeToken(owner.userId, token)).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
    expect((await findUserById(owner.userId))?.email).toBe(owner.email);
    expect(sessionResponseSchema.parse(await (await session()).json()).authenticated).toBe(true);
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Prueba SQLite');
    const { eq } = await import('drizzle-orm');
    db.sqlite.update(sqliteSchema.users).set({ email: 'conflict-free@example.test' }).where(eq(sqliteSchema.users.id, other.userId)).run();
    expect((await consumeEmailChangeToken(owner.userId, token))?.newEmail).toBe('conflict-target@example.test');
  });

  it('si falla la entrega o está deshabilitada no cambia la cuenta y conserva la solicitud anterior', async () => {
    const profile = await registerUser('mail-failure@example.test', 'Entrega');
    const user = await findUserById(profile.userId);
    if (!user) throw new Error('Falta cuenta');
    expect(await requestEmailChange(user, 'kept@example.test')).toBe(true);
    const keptCode = capturedEmailToken();
    expect(await requestEmailChange(user, 'disabled@example.test', { kind: 'disabled', send: async () => 'disabled' })).toBe(false);
    expect(await requestEmailChange(user, 'failure@example.test', { kind: 'smtp', send: async () => { throw new Error('synthetic'); } })).toBe(false);
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Prueba SQLite');
    expect(db.sqlite.select().from(sqliteSchema.emailChangeTokens).all().map(row => row.newEmail)).toEqual(['kept@example.test']);
    expect((await findUserById(user.id))?.email).toBe(user.email);
    expect((await consumeEmailChangeToken(user.id, keptCode))?.newEmail).toBe('kept@example.test');
  });

  it('requiere sesión, origen propio y códigos válidos; limita confirmaciones fallidas', async () => {
    expect((await confirmEmail(jsonRequest('/api/profile/email/confirm', { code: '000000' }))).status).toBe(401);
    const user = await registerUser('confirm-guards@example.test', 'Guardas');
    const crossOrigin = jsonRequest('/api/profile/email/confirm', { code: '000000' });
    crossOrigin.headers.set('origin', 'https://other.example.test');
    expect((await confirmEmail(crossOrigin)).status).toBe(403);
    expect((await confirmEmail(jsonRequest('/api/profile/email/confirm', { code: 'bad' }))).status).toBe(400);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Math.floor(Date.now() / 60_000) * 60_000 + 1000));
    try {
      const responses = await Promise.all(Array.from({ length: 6 }, () =>
        confirmEmail(jsonRequest('/api/profile/email/confirm', { code: '000000' })),
      ));
      expect(responses.some(response => response.status === 429)).toBe(true);
      expect((await findUserById(user.userId))?.email).toBe(user.email);
    } finally { vi.useRealTimers(); }
  });

  it('invalida enlaces de recuperación anteriores y rechaza una cuenta deshabilitada', async () => {
    const user = await registerUser('reset-invalidation@example.test', 'Recuperación');
    await forgotPassword(jsonRequest('/api/auth/forgot-password', { email: user.email }));
    const resetToken = capturedResetToken();
    await changeEmail(jsonRequest('/api/profile/email', {
      currentPassword: 'contrasena-segura', newEmail: 'reset-next@example.test',
    }));
    const token = capturedEmailToken();
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Prueba SQLite');
    const { eq } = await import('drizzle-orm');
    db.sqlite.update(sqliteSchema.users).set({ status: 'DISABLED' }).where(eq(sqliteSchema.users.id, user.userId)).run();
    expect(await consumeEmailChangeToken(user.userId, token)).toBeNull();
    db.sqlite.update(sqliteSchema.users).set({ status: 'ACTIVE' }).where(eq(sqliteSchema.users.id, user.userId)).run();
    expect((await confirmEmail(jsonRequest('/api/profile/email/confirm', { code: token }))).status).toBe(200);
    const recovery = await resetPassword(jsonRequest('/api/auth/reset-password', { token: resetToken, newPassword: 'otro-password-seguro' }));
    expect(recovery.status).toBe(400);
  });

  it('crea invitaciones como admin y no vuelve a exponer el token al listar', async () => {
    await loginBootstrap();
    const response = await postInvitation(
      jsonRequest('/api/admin/invitations', {
        email: 'invitee@example.test',
        role: 'USER',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    expect(response.status).toBe(201);
    const created = invitationCreatedResponseSchema.parse(await response.json());
    expect(created.delivery).toBe('captured');
    expect(created.inviteUrl).toContain('/register#invite=');

    const listedResponse = await getInvitations();
    const listedText = await listedResponse.text();
    const listed = invitationsResponseSchema.parse(JSON.parse(listedText));
    expect(listed.invitations).toHaveLength(1);
    expect(listedText).not.toContain('tokenHash');
  });

  it('deniega APIs admin a USER y las cuentas deshabilitadas no pueden iniciar ni usar sesión', async () => {
    const admin = await loginBootstrap();
    const user = await registerUser('user@example.test', 'User');
    expect((await getAdminUsers()).status).toBe(403);

    await updateUserForAdmin({ actorId: admin.userId, userId: user.userId, status: 'DISABLED' });
    expect(sessionResponseSchema.parse(await (await session()).json())).toEqual({ authenticated: false });
    cookieState.clear();
    const disabledLogin = await login(
      jsonRequest('/api/auth/login', {
        email: user.email,
        password: 'contrasena-segura',
      }),
    );
    expect(disabledLogin.status).toBe(401);
  });

  it('responde igual para correos activos, inexistentes y deshabilitados', async () => {
    const admin = await loginBootstrap();
    const user = await registerUser('recovery@example.test', 'Recovery');
    const active = await forgotPassword(
      jsonRequest('/api/auth/forgot-password', { email: user.email }),
    );
    const missing = await forgotPassword(
      jsonRequest('/api/auth/forgot-password', { email: 'missing@example.test' }),
    );
    await updateUserForAdmin({ actorId: admin.userId, userId: user.userId, status: 'DISABLED' });
    const disabled = await forgotPassword(
      jsonRequest('/api/auth/forgot-password', { email: user.email }),
    );

    expect([active.status, missing.status, disabled.status]).toEqual([200, 200, 200]);
    expect(await active.text()).toBe(await missing.text());
    expect(await disabled.text()).toBe(JSON.stringify({ ok: true }));
  });

  it('mantiene la respuesta genérica al aplicar rate limit', async () => {
    const responses = await Promise.all(
      Array.from({ length: 7 }, () =>
        forgotPassword(
          jsonRequest('/api/auth/forgot-password', { email: 'missing@example.test' }, 'rate-limit-ip'),
        ),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    await expect(Promise.all(responses.map((response) => response.json()))).resolves.toEqual(
      Array.from({ length: 7 }, () => ({ ok: true })),
    );
  });

  it('guarda solo hash y permite un único reset concurrente que revoca sesiones', async () => {
    const user = await registerUser('reset@example.test', 'Reset');
    await login(
      jsonRequest('/api/auth/login', {
        email: user.email,
        password: 'contrasena-segura',
      }),
    );
    const requested = await forgotPassword(
      jsonRequest('/api/auth/forgot-password', { email: user.email }),
    );
    expect(requested.status).toBe(200);
    const token = capturedResetToken();
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    const stored = db.raw
      .prepare<[], { token_hash: string }>('SELECT token_hash FROM password_reset_tokens')
      .get();
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.token_hash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 2 });

    const attempts = await Promise.all([
      resetPassword(
        jsonRequest('/api/auth/reset-password', { token, newPassword: 'nueva-contrasena' }),
      ),
      resetPassword(
        jsonRequest('/api/auth/reset-password', { token, newPassword: 'otra-contrasena' }),
      ),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(
      db.raw.prepare('SELECT used_at FROM password_reset_tokens').get(),
    ).toMatchObject({ used_at: expect.any(String) });
    expect(sessionResponseSchema.parse(await (await session()).json())).toEqual({ authenticated: false });

    const updated = await findUserByEmail(user.email);
    if (!updated) throw new Error('Cuenta de prueba no encontrada');
    const validPasswords = await Promise.all([
      verifyPassword('nueva-contrasena', updated.passwordHash),
      verifyPassword('otra-contrasena', updated.passwordHash),
    ]);
    expect(validPasswords.filter(Boolean)).toHaveLength(1);
    const oldLogin = await login(
      jsonRequest('/api/auth/login', { email: user.email, password: 'contrasena-segura' }),
    );
    expect(oldLogin.status).toBe(401);
  });

  it('rechaza con el mismo error genérico tokens expirados y reutilizados', async () => {
    const user = await registerUser('expired@example.test', 'Expired');
    await forgotPassword(jsonRequest('/api/auth/forgot-password', { email: user.email }));
    const token = capturedResetToken();
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    await db.sqlite
      .update(sqliteSchema.passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const expired = await resetPassword(
      jsonRequest('/api/auth/reset-password', { token, newPassword: 'nueva-contrasena' }),
    );
    const unknown = await resetPassword(
      jsonRequest('/api/auth/reset-password', {
        token: 'x'.repeat(43),
        newPassword: 'nueva-contrasena',
      }),
    );
    const malformed = await resetPassword(
      jsonRequest('/api/auth/reset-password', {
        token: 'invalido',
        newPassword: 'nueva-contrasena',
      }),
    );
    expect(expired.status).toBe(400);
    expect(await expired.text()).toBe(await unknown.text());
    expect(await malformed.text()).toBe(JSON.stringify({ error: 'El enlace no es válido o ha expirado' }));
  });
});
