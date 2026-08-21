import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import { verifyPassword } from '@/server/auth/password';

let temporaryDirectory: string | null = null;

function databaseUrl(name: string): string {
  temporaryDirectory ??= mkdtempSync(join(tmpdir(), 'my-closet-bootstrap-'));
  return `file:${join(temporaryDirectory, name)}`;
}

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe('administrador bootstrap', () => {
  it('no crea cuentas con configuración en blanco', async () => {
    const db = await createServerDB(parseServerEnv({ DATABASE_URL: databaseUrl('blank.db') }));
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
    db.raw.close();
  });

  it('rechaza configuración parcial', () => {
    expect(() => parseServerEnv({ BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test' })).toThrow();
    expect(() => parseServerEnv({ BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-test-password' })).toThrow();
  });

  it('crea una sola cuenta admin slot 1 con scrypt y es idempotente', async () => {
    const env = parseServerEnv({
      DATABASE_URL: databaseUrl('full.db'),
      BOOTSTRAP_ADMIN_EMAIL: 'bootstrap@example.test',
      BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-test-password',
    });
    const first = await createServerDB(env);
    if (first.dialect !== 'sqlite') throw new Error('SQLite requerido');
    const created = first.raw
      .prepare<[], { email: string; password_hash: string; role: string; status: string; admin_slot: number }>(
        'SELECT email, password_hash, role, status, admin_slot FROM users',
      )
      .get();
    expect(created).toMatchObject({
      email: 'bootstrap@example.test',
      role: 'ADMIN',
      status: 'ACTIVE',
      admin_slot: 1,
    });
    expect(created?.password_hash).toMatch(/^scrypt\$/);
    expect(created?.password_hash).not.toContain('bootstrap-test-password');
    expect(await verifyPassword('bootstrap-test-password', created?.password_hash ?? '')).toBe(true);
    first.raw.close();

    const second = await createServerDB(env);
    if (second.dialect !== 'sqlite') throw new Error('SQLite requerido');
    expect(second.raw.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    second.raw.close();
  });
});
