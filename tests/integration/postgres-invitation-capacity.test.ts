import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '@/lib/domain/ids';
import { pgSchema } from '@/server/db';
import {
  AdminAuthorizationError, createInvitation, inspectInvitationToken,
  InvitationOperationError, listInvitations,
  revokeInvitation,
} from '@/server/repositories/invitations-repository';
import { hashInvitationToken, registerAccount, registerInvitedGoogleAccount } from '@/server/repositories/users-repository';
import { updateUserForAdmin } from '@/server/repositories/admin-users-repository';
import { ADMIN_CAPACITY_LOCK } from '@/server/repositories/admin-capacity';

type ContractDB = PostgresJsDatabase<typeof pgSchema>;
type ContractTransaction = Parameters<Parameters<ContractDB['transaction']>[0]>[0];
let activeTransaction: ContractTransaction | undefined;
let client: ReturnType<typeof postgres>;
let database: ContractDB;
let observer: ReturnType<typeof postgres>;

vi.mock('@/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/db')>();
  return {
    ...actual,
    getServerDB: async () => {
      if (!activeTransaction) throw new Error('El contrato exige una transacción con tablas temporales');
      return { dialect: 'postgres', postgres: activeTransaction };
    },
  };
});

const describeStaging = process.env.INVITATION_CONTRACT_DATABASE_URL ? describe : describe.skip;

describeStaging('cupo de invitaciones PostgreSQL en tablas temporales de staging', { timeout: 20_000 }, () => {
  beforeAll(() => {
    const parsed = z.object({
      INVITATION_CONTRACT_DATABASE_URL: z.url(),
      INVITATION_CONTRACT_EXPECTED_HOST: z.string().min(1),
      INVITATION_CONTRACT_PRODUCTION_HOST: z.string().min(1),
    }).safeParse(process.env);
    if (!parsed.success) throw new Error('Faltan variables explícitas para el contrato PostgreSQL aislado');
    const env = parsed.data;
    const host = new URL(env.INVITATION_CONTRACT_DATABASE_URL).hostname.replace('-pooler', '');
    if (host !== env.INVITATION_CONTRACT_EXPECTED_HOST || host === env.INVITATION_CONTRACT_PRODUCTION_HOST) {
      throw new Error('Se rechazó el destino: el contrato solo permite el staging esperado, distinto de producción');
    }
    client = postgres(env.INVITATION_CONTRACT_DATABASE_URL, { ssl: 'require', max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
    database = drizzle(client, { schema: pgSchema });
    observer = postgres(env.INVITATION_CONTRACT_DATABASE_URL, { ssl: 'require', max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (observer) await observer.end({ timeout: 5 });
  });

  async function isolated(
    second: 'ACTIVE' | 'DISABLED' | null,
    work: (actorId: string) => Promise<void>,
  ) {
    await database.transaction(async (tx) => {
      // pg_temp shadows the unqualified Drizzle table names on this connection.
      // Copy constraints/indexes, then add FKs referring to the temporary users.
      // Never UPDATE/DELETE/INSERT into public tables or alter the existing schema.
      await tx.execute(sql`CREATE TEMPORARY TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMPORARY TABLE account_invitations (LIKE public.account_invitations INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMPORARY TABLE auth_accounts (LIKE public.auth_accounts INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMPORARY TABLE sessions (LIKE public.sessions INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`ALTER TABLE pg_temp.account_invitations ADD FOREIGN KEY (created_by) REFERENCES pg_temp.users(id)`);
      await tx.execute(sql`ALTER TABLE pg_temp.account_invitations ADD FOREIGN KEY (accepted_by) REFERENCES pg_temp.users(id)`);
      const actorId = uuid();
      await tx.insert(pgSchema.users).values({
        id: actorId, email: 'contract-admin@example.test', displayName: 'Contrato admin',
        passwordHash: 'fixture-not-for-login', role: 'ADMIN', status: 'ACTIVE', adminSlot: 1,
      });
      if (second) await tx.insert(pgSchema.users).values({
        id: uuid(), email: 'contract-second@example.test', displayName: 'Contrato segundo',
        passwordHash: 'fixture-not-for-login', role: 'ADMIN', status: second, adminSlot: second === 'ACTIVE' ? 2 : null,
      });
      activeTransaction = tx;
      try { await work(actorId); } finally { activeTransaction = undefined; }
    });
  }

  const invitationInput = (actorId: string, role: 'ADMIN' | 'USER', email = 'invited@example.test') => ({
    actorId, role, email, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  it('dos activos impiden emisión ADMIN y permiten USER', async () => {
    await isolated('ACTIVE', async (actorId) => {
      for (let index = 0; index < 3; index++) {
        await expect(createInvitation(invitationInput(actorId, 'ADMIN'))).rejects.toBeInstanceOf(InvitationOperationError);
      }
      expect(await listInvitations(actorId)).toHaveLength(0);
      expect((await createInvitation(invitationInput(actorId, 'USER'))).invitation.role).toBe('USER');
    });
  });

  it('un administrador deshabilitado no consume cupo', async () => {
    await isolated('DISABLED', async (actorId) => {
      expect((await createInvitation(invitationInput(actorId, 'ADMIN'))).invitation.role).toBe('ADMIN');
    });
  });

  it('la pendiente reserva plaza y aceptarla consume únicamente su propia reserva', async () => {
    await isolated(null, async (actorId) => {
      const first = await createInvitation(invitationInput(actorId, 'ADMIN', 'first@example.test'));
      await expect(createInvitation(invitationInput(actorId, 'ADMIN', 'second@example.test'))).rejects.toThrow('reservado');
      await registerAccount({ email: 'ignored@example.test', displayName: 'Primero', passwordHash: 'fixture-not-for-login', invitationToken: first.token, publicRegistrationEnabled: false });
      await expect(createInvitation(invitationInput(actorId, 'ADMIN', 'third@example.test'))).rejects.toThrow('dos administradores activos');
      expect((await listInvitations(actorId))[0]?.acceptedAt).not.toBeNull();
    });
  });

  it('revocar o caducar libera reserva; promoción y reactivación no la pueden robar', async () => {
    await isolated('DISABLED', async (actorId) => {
      const users = await activeTransaction!.select().from(pgSchema.users);
      const disabled = users.find((user) => user.status === 'DISABLED')!;
      const first = await createInvitation(invitationInput(actorId, 'ADMIN'));
      await expect(updateUserForAdmin({ actorId, userId: disabled.id, status: 'ACTIVE' })).rejects.toThrow('reservado');
      await activeTransaction!.update(pgSchema.users).set({ role: 'USER' }).where(eq(pgSchema.users.id, disabled.id));
      await expect(updateUserForAdmin({ actorId, userId: disabled.id, role: 'ADMIN', status: 'ACTIVE' })).rejects.toThrow('reservado');
      await revokeInvitation(actorId, first.invitation.id);
      const expired = await createInvitation(invitationInput(actorId, 'ADMIN', 'expired@example.test'));
      await activeTransaction!.update(pgSchema.accountInvitations).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(pgSchema.accountInvitations.id, expired.invitation.id));
      await expect(inspectInvitationToken(expired.token)).rejects.toThrow('expirado');
      await expect(updateUserForAdmin({ actorId, userId: disabled.id, role: 'ADMIN', status: 'ACTIVE' })).resolves.toMatchObject({ role: 'ADMIN', adminSlot: 2 });
    });
  });

  it('Google convierte su reserva sin duplicarla ni omitir el vínculo', async () => {
    await isolated(null, async (actorId) => {
      const invite = await createInvitation(invitationInput(actorId, 'ADMIN', 'google@example.test'));
      await expect(registerInvitedGoogleAccount({ invitationToken: invite.token, providerEmail: 'google@example.test', providerSubject: 'contract-google-admin', displayName: 'Google', passwordHash: 'fixture-not-for-login' }))
        .resolves.toMatchObject({ role: 'ADMIN', adminSlot: 2 });
      expect(await activeTransaction!.select().from(pgSchema.authAccounts)).toHaveLength(1);
      expect((await listInvitations(actorId))[0]?.acceptedAt).not.toBeNull();
    });
  });

  it('invitaciones antiguas sobreasignadas exigen revocar una, sin consumir ninguna al fallar', async () => {
    await isolated(null, async (actorId) => {
      const first = await createInvitation(invitationInput(actorId, 'ADMIN', 'first@example.test'));
      const legacyId = uuid();
      const legacyToken = 'contract-legacy-token';
      await activeTransaction!.insert(pgSchema.accountInvitations).values({
        id: legacyId, email: 'legacy@example.test', role: 'ADMIN', createdBy: actorId,
        expiresAt: new Date(Date.now() + 60_000), tokenHash: hashInvitationToken(legacyToken),
      });
      await expect(registerAccount({ displayName: 'Primero', passwordHash: 'fixture-not-for-login', invitationToken: first.token, publicRegistrationEnabled: false })).rejects.toMatchObject({ code: 'ADMIN_LIMIT' });
      await expect(registerInvitedGoogleAccount({ invitationToken: legacyToken, providerEmail: 'legacy@example.test', providerSubject: 'legacy-google', displayName: 'Legacy', passwordHash: 'fixture-not-for-login' })).rejects.toMatchObject({ code: 'ADMIN_LIMIT' });
      expect((await inspectInvitationToken(first.token)).acceptedAt).toBeNull();
      expect((await inspectInvitationToken(legacyToken)).acceptedAt).toBeNull();
      expect(await activeTransaction!.select().from(pgSchema.authAccounts)).toHaveLength(0);
      await revokeInvitation(actorId, legacyId);
      await expect(registerAccount({ displayName: 'Primero', passwordHash: 'fixture-not-for-login', invitationToken: first.token, publicRegistrationEnabled: false })).resolves.toMatchObject({ adminSlot: 2 });
    });
  });

  it('el bloqueo de cupo excluye otra conexión y se libera al terminar la transacción', async () => {
    await isolated(null, async (actorId) => {
      await createInvitation(invitationInput(actorId, 'ADMIN'));
      const rows = await observer`SELECT pg_try_advisory_xact_lock(${ADMIN_CAPACITY_LOCK[0]}, ${ADMIN_CAPACITY_LOCK[1]}) AS acquired`;
      expect(rows[0]?.acquired).toBe(false);
    });
    const rows = await observer`SELECT pg_try_advisory_xact_lock(${ADMIN_CAPACITY_LOCK[0]}, ${ADMIN_CAPACITY_LOCK[1]}) AS acquired`;
    expect(rows[0]?.acquired).toBe(true);
  });

  it('un actor sin permiso no puede emitir aunque quede una plaza', async () => {
    await isolated(null, async (actorId) => {
      await activeTransaction!.update(pgSchema.users).set({ role: 'USER', adminSlot: null }).where(eq(pgSchema.users.id, actorId));
      await expect(createInvitation(invitationInput(actorId, 'ADMIN'))).rejects.toBeInstanceOf(AdminAuthorizationError);
    });
  });
});
