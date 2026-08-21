import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuid } from '@/lib/domain/ids';
import { closeServerDB, getServerDB, pgSchema } from '@/server/db';
import {
  createUser,
  findUserByEmail,
  updateProfile,
} from '@/server/repositories/users-repository';
import {
  findGoogleAccountByUserId,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';
import {
  pullAll,
  upsertGarment,
} from '@/server/repositories/sync-repository';

const enabled = process.env.DATABASE_PROVIDER === 'postgres' && Boolean(process.env.DATABASE_URL);
const describePostgres = enabled ? describe : describe.skip;
const cleanupUserIds: string[] = [];

describePostgres('contrato de repositorios PostgreSQL', () => {
  afterAll(async () => {
    const db = await getServerDB();
    if (db.dialect === 'postgres' && cleanupUserIds.length > 0) {
      for (const userId of cleanupUserIds) {
        await db.postgres.delete(pgSchema.users).where(eq(pgSchema.users.id, userId));
      }
    }
    await closeServerDB();
  });

  it('crea, consulta y actualiza una cuenta', async () => {
    const suffix = uuid();
    const user = await createUser({
      email: `contract-${suffix}@example.test`,
      displayName: 'Contrato PostgreSQL',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(user.id);

    expect(await findUserByEmail(user.email)).toMatchObject({
      id: user.id,
      displayName: 'Contrato PostgreSQL',
    });
    expect(await updateProfile(user.id, { displayName: 'Contrato actualizado' }))
      .toMatchObject({ displayName: 'Contrato actualizado' });
  });

  it('vincula Google explícitamente y sincroniza una prenda', async () => {
    const suffix = uuid();
    const user = await createUser({
      email: `google-${suffix}@example.test`,
      displayName: 'Google Contract',
      passwordHash: 'scrypt:test-contract',
    });
    cleanupUserIds.push(user.id);

    const linked = await linkGoogleAccount({
      userId: user.id,
      providerSubject: `subject-${suffix}`,
      providerEmail: user.email,
    });
    expect(await findGoogleAccountByUserId(user.id)).toMatchObject({ id: linked.id });
    expect(await unlinkGoogleAccount(user.id)).toBe(true);

    const now = new Date().toISOString();
    const garment = {
      id: uuid(),
      userId: user.id,
      shareableId: uuid(),
      name: 'Prenda contrato',
      category: 'TOP' as const,
      colors: ['NEGRO'],
      brand: null,
      size: null,
      notes: null,
      washingInstructions: null,
      dateAcquired: null,
      archived: false,
      favorite: true,
      photoId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      syncStatus: 'pending' as const,
    };
    expect(await upsertGarment(user.id, garment)).toMatchObject({ status: 'applied' });
    const pulled = await pullAll(user.id, null);
    expect(pulled.garments).toContainEqual(expect.objectContaining({ id: garment.id }));
  });
});
