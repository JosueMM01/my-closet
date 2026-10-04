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
} from '@/server/repositories/invitations-repository';
import { registerAccount } from '@/server/repositories/users-repository';

type ContractDB = PostgresJsDatabase<typeof pgSchema>;
type ContractTransaction = Parameters<Parameters<ContractDB['transaction']>[0]>[0];
let activeTransaction: ContractTransaction | undefined;
let client: ReturnType<typeof postgres>;
let database: ContractDB;

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

describeStaging('cupo de invitaciones PostgreSQL en tablas temporales de staging', () => {
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
  });
  afterAll(async () => { if (client) await client.end({ timeout: 5 }); });

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

  it('las pendientes no reservan plaza y la antigua no permite el tercer admin', async () => {
    await isolated(null, async (actorId) => {
      const first = await createInvitation(invitationInput(actorId, 'ADMIN', 'first@example.test'));
      const second = await createInvitation(invitationInput(actorId, 'ADMIN', 'second@example.test'));
      await registerAccount({ email: 'ignored@example.test', displayName: 'Primero', passwordHash: 'fixture-not-for-login', invitationToken: first.token, publicRegistrationEnabled: false });
      await expect(registerAccount({ email: 'ignored@example.test', displayName: 'Segundo', passwordHash: 'fixture-not-for-login', invitationToken: second.token, publicRegistrationEnabled: false }))
        .rejects.toMatchObject({ code: 'ADMIN_LIMIT' });
      expect((await inspectInvitationToken(second.token)).acceptedAt).toBeNull();
    });
  });

  it('un actor sin permiso no puede emitir aunque quede una plaza', async () => {
    await isolated(null, async (actorId) => {
      await activeTransaction!.update(pgSchema.users).set({ role: 'USER', adminSlot: null }).where(eq(pgSchema.users.id, actorId));
      await expect(createInvitation(invitationInput(actorId, 'ADMIN'))).rejects.toBeInstanceOf(AdminAuthorizationError);
    });
  });
});
