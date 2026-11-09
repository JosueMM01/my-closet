import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { closeServerDB, getServerDB } from '@/server/db';
import * as env from '@/server/env';
import { hashPassword } from '@/server/auth/password';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { createUser, findUserByEmail, findUserById } from '@/server/repositories/users-repository';
import { updateUserForAdmin } from '@/server/repositories/admin-users-repository';

const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
  set: (name: string, value: string) => cookies.set(name, value),
  delete: (name: string) => cookies.delete(name),
}) }));
import { POST as login } from '@/app/api/auth/login/route';
import { DELETE as remove } from '@/app/api/admin/users/[id]/route';
import { GET as list } from '@/app/api/admin/users/route';

const email = 'isolated-admin-delete@example.test';
const password = 'isolated-admin-delete-password';
let enabled = true;

beforeEach(async () => {
  vi.stubEnv('DATABASE_PROVIDER', 'sqlite'); vi.stubEnv('DATABASE_URL', 'file::memory:');
  vi.stubEnv('IMAGE_PROVIDER', 'local'); vi.stubEnv('EMAIL_PROVIDER', 'capture');
  vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', email); vi.stubEnv('BOOTSTRAP_ADMIN_PASSWORD', password);
  vi.stubEnv('AUTH_SECRET', 'isolated-admin-delete-only');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
  enabled = true;
  vi.spyOn(env, 'getEnv').mockImplementation(() => env.parseServerEnv({
    DATABASE_PROVIDER: 'sqlite', DATABASE_URL: 'file::memory:', IMAGE_PROVIDER: 'local', EMAIL_PROVIDER: 'capture',
    NODE_ENV: 'test', NEXT_PUBLIC_APP_URL: 'http://localhost', AUTH_SECRET: 'isolated-admin-delete-only', BOOTSTRAP_ADMIN_EMAIL: email,
    BOOTSTRAP_ADMIN_PASSWORD: password, ACCOUNT_DELETION_ENABLED: 'true', ADMIN_ACCOUNT_DELETION_ENABLED: String(enabled),
  }));
  cookies.clear(); await closeServerDB(); await resetRateLimits();
});
afterEach(async () => { await closeServerDB(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function prepare() {
  expect((await login(new Request('http://localhost/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  }))).status).toBe(200);
  const actor = await findUserByEmail(email);
  if (!actor) throw new Error('Missing isolated admin');
  const target = await createUser({ email: `${randomUUID()}@example.test`, displayName: 'Sintético', passwordHash: await hashPassword('target-only-password') });
  return { actor, target };
}
function request(id: string, currentPassword = password, origin = 'http://localhost') {
  return remove(new Request(`http://localhost/api/admin/users/${id}`, {
    method: 'DELETE', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ acknowledge: true, currentPassword }),
  }), { params: Promise.resolve({ id }) });
}

describe('API de baja administrativa aislada', () => {
  it('requiere ambas banderas y autorización; no envía nada a terceros', async () => {
    enabled = false;
    expect((await request(randomUUID())).status).toBe(404);
    enabled = true;
    expect((await request(randomUUID())).status).toBe(401);
  });
  it('rechaza CSRF, contraseña incorrecta y objetivo activo antes de borrar', async () => {
    const { target } = await prepare();
    expect((await request(target.id, password, 'https://external.example.test')).status).toBe(403);
    expect((await request(target.id, 'wrong-password')).status).toBe(403);
    expect((await request(target.id)).status).toBe(409);
    expect((await findUserById(target.id))?.status).toBe('ACTIVE');
  });
  it('valida UUID, confirmación y tipo de contraseña en el servidor', async () => {
    const { target } = await prepare();
    expect((await request('not-a-uuid')).status).toBe(400);
    for (const body of [{ currentPassword: password }, { acknowledge: true, currentPassword: 12345678 }]) {
      const response = await remove(new Request(`http://localhost/api/admin/users/${target.id}`, {
        method: 'DELETE', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: target.id }) });
      expect(response.status).toBe(400);
    }
  });
  it('elimina únicamente el objetivo desactivado y lo retira del listado sin cerrar sesión ADMIN', async () => {
    const { actor, target } = await prepare();
    await updateUserForAdmin({ actorId: actor.id, userId: target.id, status: 'DISABLED' });
    const beforeCookies = new Map(cookies);
    expect((await request(target.id)).status).toBe(202);
    expect(cookies).toEqual(beforeCookies);
    const result = await list(); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ adminDeletionEnabled: true, users: [expect.objectContaining({ userId: actor.id })] });
    expect((await findUserById(target.id))?.email).toMatch(/@deleted\.invalid$/);
    expect((await request(target.id)).status).toBe(409);
  });
  it('rechaza USER aun si conoce su contraseña y limita los intentos del ADMIN', async () => {
    const { actor, target } = await prepare();
    await updateUserForAdmin({ actorId: actor.id, userId: target.id, status: 'DISABLED' });
    // All attempts must belong to one fixed window, even if the suite happens
    // to run across a wall-clock minute boundary. Do not weaken the real guard.
    vi.spyOn(Date, 'now').mockReturnValue(Math.floor(Date.now() / 60_000) * 60_000 + 10_000);
    for (let attempt = 0; attempt < 5; attempt++) expect((await request(target.id, 'incorrect')).status).toBe(403);
    expect((await request(target.id)).status).toBe(429);
    expect((await findUserById(target.id))?.status).toBe('DISABLED');
    // A normal user cannot borrow an administrator session or password.
    cookies.clear();
    const other = await createUser({ email: 'normal@example.test', displayName: 'Normal', passwordHash: await hashPassword('normal-password-long') });
    await login(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: other.email, password: 'normal-password-long' }) }));
    expect((await request(target.id, 'normal-password-long')).status).toBe(403);
    const db = await getServerDB(); expect(db.dialect).toBe('sqlite');
  });
});
