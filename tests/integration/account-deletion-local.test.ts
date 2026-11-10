import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDB } from '@/lib/local/db';
import { getLocalProfile, markAccountDeleted, purgeDeletedAccount, setLocalProfile } from '@/lib/local/kv';
import { createGarment } from '@/lib/local/repositories';

const target = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const profile = { userId: target, email: 'synthetic@example.test', displayName: 'Sintético', createdAt: new Date().toISOString(), role: 'USER' as const, profileImageId: null };
beforeEach(async () => {
  for (const table of getDB().tables) await table.clear();
});

describe('baja local con recibo del servidor', () => {
  it('no borra nada sin marcador de una baja confirmada', async () => {
    await setLocalProfile(profile);
    await createGarment(target, { name: 'Propia', category: 'tops', colors: [] });
    await purgeDeletedAccount(target);
    expect(await getLocalProfile()).toMatchObject({ userId: target });
    expect(await getDB().garments.count()).toBe(1);
  });
  it('limpia al arrancar sin borrar las entidades ni la outbox de otra cuenta', async () => {
    await setLocalProfile(profile);
    await createGarment(target, { name: 'Propia', category: 'tops', colors: [] });
    const foreign = await createGarment(other, { name: 'Ajena', category: 'tops', colors: [] });
    await getDB().kv.put({ key: `recommendations:context:${target}`, value: 'synthetic' });
    await markAccountDeleted(target);
    expect(await getLocalProfile()).toBeNull();
    expect(await getDB().garments.toArray()).toMatchObject([{ id: foreign.id, userId: other }]);
    expect((await getDB().outbox.toArray()).every(op => op.userId === other)).toBe(true);
    expect(await getDB().kv.get(`recommendations:context:${target}`)).toBeUndefined();
    expect(await getDB().kv.get(`account-deleted:${target}`)).toBeDefined();
    await setLocalProfile(profile); // A stale session response must not restore it.
    expect(await getLocalProfile()).toBeNull();
    await purgeDeletedAccount(target); // Idempotent.
    expect(await getDB().garments.count()).toBe(1);
  });
});
