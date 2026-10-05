import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeServerDB, createServerDB, getServerDB, sqliteSchema } from '@/server/db';
import { parseServerEnv } from '@/server/env';
import {
  AccountError,
  findUserByEmail,
  findUserById,
  registerAccount,
  registerInvitedGoogleAccount,
  updateEmail,
  updatePasswordHash,
  updateProfile,
} from '@/server/repositories/users-repository';
import {
  AdminAuthorizationError,
  createInvitation,
  InvitationOperationError,
  listInvitations,
  revokeInvitation,
} from '@/server/repositories/invitations-repository';
import {
  AdminUserOperationError,
  listUsersForAdmin,
  updateUserForAdmin,
} from '@/server/repositories/admin-users-repository';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createAndDeliverInvitation } from '@/server/services/invitation-service';

const BOOTSTRAP_EMAIL = 'bootstrap-admin@example.test';
const BOOTSTRAP_PASSWORD = 'bootstrap-test-password';

async function register(email: string, overrides: Partial<Parameters<typeof registerAccount>[0]> = {}) {
  return registerAccount({
    email,
    displayName: email.split('@')[0] ?? 'Usuario',
    passwordHash: await hashPassword('contrasena-segura'),
    publicRegistrationEnabled: true,
    ...overrides,
  });
}

async function bootstrapAdmin() {
  await getServerDB();
  const admin = await findUserByEmail(BOOTSTRAP_EMAIL);
  if (!admin) throw new Error('No se creó el administrador bootstrap de prueba');
  return admin;
}

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
  process.env.BOOTSTRAP_ADMIN_EMAIL = BOOTSTRAP_EMAIL;
  process.env.BOOTSTRAP_ADMIN_PASSWORD = BOOTSTRAP_PASSWORD;
  await closeServerDB();
});

afterEach(async () => {
  await closeServerDB();
});

describe('cuentas, roles y administradores', () => {
  it('actualiza un esquema SQLite anterior de forma segura e idempotente', async () => {
    const dbPath = path.join(os.tmpdir(), `my-closet-upgrade-${randomUUID()}.db`);
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    legacy.close();

    try {
      const env = parseServerEnv({ DATABASE_URL: `file:${dbPath}`, NODE_ENV: 'test' });
      const first = await createServerDB(env);
      if (first.dialect !== 'sqlite') throw new Error('SQLite requerido');
      const columns = first.raw
        .prepare<[], { name: string }>('PRAGMA table_info(users)')
        .all()
        .map((column) => column.name);
      expect(columns).toEqual(
        expect.arrayContaining(['role', 'status', 'admin_slot', 'profile_image_id']),
      );
      expect(
        first.raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_invitations'")
          .get(),
      ).toBeTruthy();
      first.raw.close();

      const second = await createServerDB(env);
      if (second.dialect !== 'sqlite') throw new Error('SQLite requerido');
      second.raw.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      }
    }
  });

  it('mantiene como usuarios las cuentas del registro público explícito', async () => {
    const admin = await bootstrapAdmin();
    const first = await register('primera@example.test');
    const second = await register('segunda@example.test');

    expect(admin).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', adminSlot: 1 });
    expect(first).toMatchObject({ role: 'USER', status: 'ACTIVE', adminSlot: null });
    expect(second).toMatchObject({ role: 'USER', status: 'ACTIVE', adminSlot: null });
  });

  it('exige invitación cuando el registro público está deshabilitado', async () => {
    await expect(
      register('cerrado@example.test', {
        publicRegistrationEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_REGISTRATION_DISABLED' } satisfies Partial<AccountError>);
  });

  it('limita a dos administradores activos y protege el acceso propio/último admin', async () => {
    const admin = await bootstrapAdmin();
    const second = await register('dos@example.test');
    const third = await register('tres@example.test');

    const promoted = await updateUserForAdmin({
      actorId: admin.id,
      userId: second.id,
      role: 'ADMIN',
    });
    expect(promoted.adminSlot).toBe(2);
    await expect(
      updateUserForAdmin({ actorId: admin.id, userId: third.id, role: 'ADMIN' }),
    ).rejects.toThrow('Ya existen dos administradores activos');

    await updateUserForAdmin({ actorId: admin.id, userId: second.id, role: 'USER' });
    await expect(
      updateUserForAdmin({ actorId: admin.id, userId: admin.id, status: 'DISABLED' }),
    ).rejects.toBeInstanceOf(AdminUserOperationError);

    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    expect(() =>
      db.raw
        .prepare("UPDATE users SET role = 'USER', admin_slot = NULL WHERE id = ?")
        .run(admin.id),
    ).toThrow(/ultimo administrador/i);
  });

  it('rechaza usuarios no administradores dentro del repositorio', async () => {
    await bootstrapAdmin();
    const user = await register('user@example.test');

    await expect(listUsersForAdmin(user.id)).rejects.toBeInstanceOf(AdminAuthorizationError);
    await expect(
      createInvitation({
        actorId: user.id,
        email: 'invitee@example.test',
        role: 'USER',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(AdminAuthorizationError);
  });

  it('revoca sesiones al deshabilitar un usuario', async () => {
    const admin = await bootstrapAdmin();
    const user = await register('user@example.test');
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    await db.sqlite.insert(sqliteSchema.sessions).values({
      id: 'session-hash',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await updateUserForAdmin({ actorId: admin.id, userId: user.id, status: 'DISABLED' });
    const sessions = await db.sqlite.select().from(sqliteSchema.sessions);
    expect(sessions).toHaveLength(0);
    expect((await findUserById(user.id))?.status).toBe('DISABLED');
  });
});

describe('invitaciones de cuenta', () => {
  it('con dos admins activos rechaza emisión antes de persistir o enviar correo, pero permite USER', async () => {
    const admin = await bootstrapAdmin();
    const second = await register('second-admin@example.test');
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, role: 'ADMIN' });
    const send = vi.fn(async () => 'captured' as const);
    await expect(createAndDeliverInvitation({
      actorId: admin.id, email: 'blocked@example.test', role: 'ADMIN',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, {
      env: parseServerEnv({ NODE_ENV: 'test', EMAIL_PROVIDER: 'capture' }),
      mailProvider: { kind: 'capture', send },
    })).rejects.toBeInstanceOf(InvitationOperationError);
    expect(send).not.toHaveBeenCalled();
    expect(await listInvitations(admin.id)).toHaveLength(0);
    const allowed = await createInvitation({
      actorId: admin.id, email: 'user-allowed@example.test', role: 'USER',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(allowed.invitation.role).toBe('USER');
  });

  it('solicitudes ADMIN repetidas/concurrentes no crean registros cuando el cupo está lleno', async () => {
    const admin = await bootstrapAdmin();
    const second = await register('second-admin@example.test');
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, role: 'ADMIN' });
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => createInvitation({
      actorId: admin.id, email: `blocked-${index}@example.test`, role: 'ADMIN',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })));
    expect(results.every((result) => result.status === 'rejected'
      && result.reason instanceof InvitationOperationError)).toBe(true);
    expect(await listInvitations(admin.id)).toHaveLength(0);
  });

  it('una pendiente reserva plaza; aceptarla consume su propia reserva una sola vez', async () => {
    const admin = await bootstrapAdmin();
    const input = { actorId: admin.id, role: 'ADMIN' as const, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const first = await createInvitation({ ...input, email: 'first-admin@example.test' });
    await expect(createInvitation({ ...input, email: 'second-admin@example.test' })).rejects.toThrow('Revoca una invitación ADMIN');
    await register('ignored@example.test', { invitationToken: first.token, publicRegistrationEnabled: false });
    expect((await listInvitations(admin.id))[0]?.acceptedAt).not.toBeNull();
    expect((await listUsersForAdmin(admin.id)).filter((user) => user.role === 'ADMIN' && user.status === 'ACTIVE')).toHaveLength(2);
    await expect(createInvitation({ ...input, email: 'third-admin@example.test' })).rejects.toThrow('dos administradores activos');
  });

  it('cinco solicitudes con una plaza libre generan una única reserva', async () => {
    const admin = await bootstrapAdmin();
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => createInvitation({
      actorId: admin.id, email: `reserved-${index}@example.test`, role: 'ADMIN',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await listInvitations(admin.id)).toHaveLength(1);
  });

  it('revocación y caducidad liberan plaza, sin contar las invitaciones USER', async () => {
    const admin = await bootstrapAdmin();
    const input = { actorId: admin.id, role: 'ADMIN' as const, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const first = await createInvitation({ ...input, email: 'revoked@example.test' });
    await revokeInvitation(admin.id, first.invitation.id);
    await expect(register('ignored@example.test', { invitationToken: first.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    const second = await createInvitation({ ...input, email: 'expired@example.test' });
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    db.raw.prepare('UPDATE account_invitations SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1_000).toISOString(), second.invitation.id);
    await createInvitation({ ...input, role: 'USER', email: 'user@example.test' });
    expect((await createInvitation({ ...input, email: 'available@example.test' })).invitation.role).toBe('ADMIN');
    await expect(register('ignored@example.test', { invitationToken: second.token })).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });

  it('la reserva impide promociones y reactivaciones hasta revocarse', async () => {
    const admin = await bootstrapAdmin();
    const second = await register('disabled@example.test');
    const user = await register('user@example.test');
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, role: 'ADMIN' });
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, status: 'DISABLED' });
    const invite = await createInvitation({ actorId: admin.id, role: 'ADMIN', email: 'reserved@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await expect(updateUserForAdmin({ actorId: admin.id, userId: user.id, role: 'ADMIN' })).rejects.toThrow('reservado');
    await expect(updateUserForAdmin({ actorId: admin.id, userId: second.id, status: 'ACTIVE' })).rejects.toThrow('reservado');
    await expect(updateUserForAdmin({ actorId: admin.id, userId: admin.id, role: 'ADMIN' })).resolves.toMatchObject({ role: 'ADMIN' });
    await revokeInvitation(admin.id, invite.invitation.id);
    await expect(updateUserForAdmin({ actorId: admin.id, userId: second.id, status: 'ACTIVE' })).resolves.toMatchObject({ status: 'ACTIVE', adminSlot: 2 });
  });

  it('Google convierte una reserva en cuenta ADMIN y vínculo atómicamente', async () => {
    const admin = await bootstrapAdmin();
    const invite = await createInvitation({ actorId: admin.id, role: 'ADMIN', email: 'google@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await expect(registerInvitedGoogleAccount({ invitationToken: invite.token, providerEmail: 'google@example.test', providerSubject: 'google-admin-fixture', displayName: 'Google', passwordHash: 'test-only-hash' }))
      .resolves.toMatchObject({ role: 'ADMIN', adminSlot: 2 });
    expect((await listInvitations(admin.id))[0]?.acceptedAt).not.toBeNull();
  });

  it('un admin deshabilitado libera cupo para emitir una nueva invitación', async () => {
    const admin = await bootstrapAdmin();
    const second = await register('disabled-admin@example.test');
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, role: 'ADMIN' });
    await updateUserForAdmin({ actorId: admin.id, userId: second.id, status: 'DISABLED' });
    expect((await createInvitation({
      actorId: admin.id, email: 'next-admin@example.test', role: 'ADMIN',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).invitation.role).toBe('ADMIN');
  });

  it('guarda solo el hash, deriva correo/rol y permite un único uso', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvitation({
      actorId: admin.id,
      email: ' Invitada@Example.Test ',
      role: 'ADMIN',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    const stored = await db.sqlite.select().from(sqliteSchema.accountInvitations);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored[0]?.tokenHash).not.toBe(created.token);
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(await listInvitations(admin.id))).not.toContain(stored[0]?.tokenHash);

    const accepted = await register('otra@example.test', {
      invitationToken: created.token,
      publicRegistrationEnabled: false,
    });
    expect(accepted).toMatchObject({
      email: 'invitada@example.test',
      role: 'ADMIN',
      adminSlot: 2,
    });
    await expect(
      register('invitada@example.test', { invitationToken: created.token }),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('rechaza invitaciones expiradas', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvitation({
      actorId: admin.id,
      email: 'tarde@example.test',
      role: 'USER',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    await db.sqlite
      .update(sqliteSchema.accountInvitations)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() });

    await expect(
      register('tarde@example.test', {
        invitationToken: created.token,
        publicRegistrationEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' } satisfies Partial<AccountError>);
  });
});

describe('cambios de credenciales', () => {
  it('actualiza contraseña y normaliza el nuevo correo', async () => {
    const user = await register('original@example.test');
    const nextHash = await hashPassword('nueva-contrasena');
    await updatePasswordHash(user.id, nextHash);
    const changed = await updateEmail(user.id, ' NUEVO@Example.Test ');

    expect(changed?.email).toBe('nuevo@example.test');
    expect(await verifyPassword('nueva-contrasena', (await findUserById(user.id))?.passwordHash ?? '')).toBe(true);
    expect(await verifyPassword('contrasena-segura', nextHash)).toBe(false);
  });

  it('solo permite asociar al perfil una imagen propia ya subida', async () => {
    const owner = await register('owner@example.test');
    const other = await register('other@example.test');
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('SQLite requerido');
    const imageId = randomUUID();
    const now = new Date().toISOString();
    await db.sqlite.insert(sqliteSchema.images).values({
      id: imageId,
      userId: owner.id,
      mimeType: 'image/webp',
      width: 10,
      height: 10,
      byteSize: 12,
      data: Buffer.from('RIFF0000WEBP'),
      remoteUrl: `/api/images/${imageId}`,
      storageProvider: 'local',
      storageKey: imageId,
      createdAt: now,
      updatedAt: now,
    });

    await expect(updateProfile(other.id, { profileImageId: imageId })).rejects.toThrow(
      'La imagen no pertenece a esta cuenta',
    );
    expect(await updateProfile(owner.id, { profileImageId: imageId })).toMatchObject({
      profileImageId: imageId,
    });
    expect(await updateProfile(owner.id, { displayName: 'Nombre nuevo' })).toMatchObject({
      displayName: 'Nombre nuevo',
      profileImageId: imageId,
    });
  });
});
