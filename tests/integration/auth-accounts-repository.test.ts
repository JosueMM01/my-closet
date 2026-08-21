import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeServerDB, getSqlite, sqliteSchema } from '@/server/db';
import {
  AuthAccountError,
  findActiveUserByGoogleSubject,
  findGoogleAccountByUserId,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import { createUser } from '@/server/repositories/users-repository';
import { eq } from 'drizzle-orm';

beforeEach(async () => {
  process.env.DATABASE_URL = 'file::memory:';
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  await closeServerDB();
});

afterEach(closeServerDB);

describe('repositorio de cuentas Google', () => {
  it('vincula, encuentra y desvincula una cuenta para un actor activo', async () => {
    const user = await createUser({
      email: 'person@example.test',
      displayName: 'Person',
      passwordHash: 'password-hash-remains-required',
    });
    const linked = await linkGoogleAccount({
      userId: user.id,
      providerSubject: 'google-subject-1',
      providerEmail: ' PERSON@EXAMPLE.TEST ',
    });

    expect(linked).toMatchObject({
      userId: user.id,
      provider: 'GOOGLE',
      providerEmail: 'person@example.test',
    });
    await expect(findGoogleAccountByUserId(user.id)).resolves.toEqual(linked);
    await expect(findActiveUserByGoogleSubject('google-subject-1')).resolves.toMatchObject({
      id: user.id,
      passwordHash: 'password-hash-remains-required',
    });
    await expect(unlinkGoogleAccount(user.id)).resolves.toBe(true);
    await expect(findGoogleAccountByUserId(user.id)).resolves.toBeNull();
  });

  it('impone unicidad por subject y por usuario/proveedor', async () => {
    const first = await createUser({
      email: 'first@example.test',
      displayName: 'First',
      passwordHash: 'hash',
    });
    const second = await createUser({
      email: 'second@example.test',
      displayName: 'Second',
      passwordHash: 'hash',
    });
    await linkGoogleAccount({
      userId: first.id,
      providerSubject: 'subject-first',
      providerEmail: first.email,
    });

    await expect(
      linkGoogleAccount({
        userId: second.id,
        providerSubject: 'subject-first',
        providerEmail: second.email,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(
      linkGoogleAccount({
        userId: first.id,
        providerSubject: 'subject-other',
        providerEmail: first.email,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
  });

  it('rechaza correo distinto y actores deshabilitados', async () => {
    const user = await createUser({
      email: 'active@example.test',
      displayName: 'Active',
      passwordHash: 'hash',
    });
    await expect(
      linkGoogleAccount({
        userId: user.id,
        providerSubject: 'subject-mismatch',
        providerEmail: 'other@example.test',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_MISMATCH' });

    await linkGoogleAccount({
      userId: user.id,
      providerSubject: 'subject-disabled',
      providerEmail: user.email,
    });
    const sqlite = await getSqlite();
    await sqlite
      .update(sqliteSchema.users)
      .set({ status: 'DISABLED' })
      .where(eq(sqliteSchema.users.id, user.id));
    await expect(
      linkGoogleAccount({
        userId: user.id,
        providerSubject: 'another-disabled-subject',
        providerEmail: user.email,
      }),
    ).rejects.toBeInstanceOf(AuthAccountError);
    await expect(findActiveUserByGoogleSubject('subject-disabled')).resolves.toBeNull();
    await expect(unlinkGoogleAccount(user.id)).rejects.toMatchObject({ code: 'ACTOR_INVALID' });
  });
});
