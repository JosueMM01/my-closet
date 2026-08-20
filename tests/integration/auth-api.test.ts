import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authResponseSchema,
  invitationCreatedResponseSchema,
  invitationsResponseSchema,
  sessionResponseSchema,
} from '@/lib/domain/validation';
import { closeServerDB } from '@/server/db';
import { updateUserForAdmin } from '@/server/repositories/admin-users-repository';

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
import { GET as providers } from '@/app/api/auth/providers/route';
import { POST as register } from '@/app/api/auth/register/route';
import { GET as session } from '@/app/api/auth/session/route';
import { POST as changeEmail } from '@/app/api/profile/email/route';
import { POST as changePassword } from '@/app/api/profile/password/route';

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

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
  process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
  cookieState.clear();
  await closeServerDB();
});

afterEach(async () => {
  await closeServerDB();
});

describe('API de cuentas y perfil', () => {
  it('anuncia registro público y crea la primera cuenta local como admin', async () => {
    const capabilities = await providers();
    expect(await capabilities.json()).toMatchObject({
      credentials: true,
      publicRegistration: true,
      invitationRegistration: true,
    });

    const profile = await registerUser('api-admin@example.test', 'API Admin');
    expect(profile).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', profileImageId: null });
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
    await registerUser('inviter@example.test', 'Inviter');
    const response = await postInvitation(
      jsonRequest('/api/admin/invitations', {
        email: 'invitee@example.test',
        role: 'USER',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    expect(response.status).toBe(201);
    const created = invitationCreatedResponseSchema.parse(await response.json());
    expect(created.delivery).toBe('disabled');
    if (created.delivery !== 'disabled') throw new Error('Entrega disabled esperada');
    expect(created.token).toHaveLength(43);
    expect(created.inviteUrl).toContain(`/register#invite=${created.token}`);

    const listedResponse = await getInvitations();
    const listedText = await listedResponse.text();
    const listed = invitationsResponseSchema.parse(JSON.parse(listedText));
    expect(listed.invitations).toHaveLength(1);
    expect(listedText).not.toContain(created.token);
    expect(listedText).not.toContain('tokenHash');
  });

  it('deniega APIs admin a USER y las cuentas deshabilitadas no pueden iniciar ni usar sesión', async () => {
    const admin = await registerUser('admin@example.test', 'Admin');
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
});
