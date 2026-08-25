import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeServerDB, getSqlite, sqliteSchema } from '@/server/db';
import { createInvitation, inspectInvitationToken } from '@/server/repositories/invitations-repository';
import {
  createUser,
  registerAccount,
  registerInvitedGoogleAccount,
} from '@/server/repositories/users-repository';

async function createAdmin() {
  const admin = await createUser({
    email: 'admin@example.test',
    displayName: 'Admin',
    passwordHash: 'admin-hash',
  });
  const sqlite = await getSqlite();
  await sqlite.update(sqliteSchema.users).set({ role: 'ADMIN', adminSlot: 1 })
    .where(eq(sqliteSchema.users.id, admin.id));
  return admin;
}

async function invitation(email: string) {
  const admin = await createAdmin();
  return createInvitation({
    actorId: admin.id,
    email,
    role: 'USER',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  await closeServerDB();
});

afterEach(closeServerDB);

describe('registro seguro por invitación', () => {
  it('deriva el correo del token y lo consume dentro del registro', async () => {
    const created = await invitation('Invitada@Example.Test');
    await expect(inspectInvitationToken(created.token)).resolves.toMatchObject({
      email: 'invitada@example.test',
    });

    const user = await registerAccount({
      displayName: 'Persona Invitada',
      passwordHash: 'password-hash',
      invitationToken: created.token,
      publicRegistrationEnabled: false,
    });

    expect(user.email).toBe('invitada@example.test');
    const sqlite = await getSqlite();
    expect(sqlite.select().from(sqliteSchema.accountInvitations).get()).toMatchObject({
      acceptedBy: user.id,
      acceptedAt: expect.any(String),
    });
    await expect(inspectInvitationToken(created.token)).rejects.toThrow('ya fue utilizada');
  });

  it('Google exige el correo de la invitación y no deja escrituras parciales', async () => {
    const created = await invitation('persona@example.test');
    await expect(registerInvitedGoogleAccount({
      invitationToken: created.token,
      providerSubject: 'wrong-subject',
      providerEmail: 'otra@example.test',
      displayName: 'Otra persona',
      passwordHash: 'random-hash',
    })).rejects.toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });

    const sqlite = await getSqlite();
    expect(sqlite.select().from(sqliteSchema.authAccounts).all()).toHaveLength(0);
    expect(sqlite.select().from(sqliteSchema.accountInvitations).get()?.acceptedAt).toBeNull();

    const user = await registerInvitedGoogleAccount({
      invitationToken: created.token,
      providerSubject: 'correct-subject',
      providerEmail: 'PERSONA@EXAMPLE.TEST',
      displayName: 'Persona desde Google',
      passwordHash: 'random-hash',
    });
    expect(user).toMatchObject({ email: 'persona@example.test', displayName: 'Persona desde Google' });
    expect(sqlite.select().from(sqliteSchema.authAccounts).get()).toMatchObject({
      userId: user.id,
      providerSubject: 'correct-subject',
    });
  });

  it('dos reintentos concurrentes solo crean una cuenta', async () => {
    const created = await invitation('concurrente@example.test');
    const attempts = await Promise.allSettled([
      registerInvitedGoogleAccount({
        invitationToken: created.token,
        providerSubject: 'same-subject',
        providerEmail: 'concurrente@example.test',
        displayName: 'Concurrente',
        passwordHash: 'hash-one',
      }),
      registerInvitedGoogleAccount({
        invitationToken: created.token,
        providerSubject: 'same-subject',
        providerEmail: 'concurrente@example.test',
        displayName: 'Concurrente',
        passwordHash: 'hash-two',
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const sqlite = await getSqlite();
    expect(sqlite.select().from(sqliteSchema.users).all()).toHaveLength(2);
    expect(sqlite.select().from(sqliteSchema.authAccounts).all()).toHaveLength(1);
  });
});
