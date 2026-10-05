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

beforeEach(async () => {
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
});

describe('API de cuentas y perfil', () => {
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
    expect(await emailResponse.json()).toEqual({ email: 'nuevo-perfil@example.test' });
    const current = sessionResponseSchema.parse(await (await session()).json());
    expect(current.authenticated && current.profile.email).toBe('nuevo-perfil@example.test');

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
