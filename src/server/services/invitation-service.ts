import 'server-only';

import { getEnv, type ServerEnv } from '@/server/env';
import { buildInvitationUrl, createInvitationEmail } from '@/server/mail/invitation-email';
import { createMailProvider, type MailProvider } from '@/server/mail';
import {
  createInvitation,
  revokeInvitation,
  type InvitationRecord,
} from '@/server/repositories/invitations-repository';

type CreateInvitationInput = Parameters<typeof createInvitation>[0];

interface InvitationServiceDependencies {
  env?: ServerEnv;
  mailProvider?: MailProvider;
  create?: typeof createInvitation;
  revoke?: typeof revokeInvitation;
}

export class InvitationDeliveryError extends Error {
  constructor() {
    super('No se pudo entregar la invitación');
    this.name = 'InvitationDeliveryError';
  }
}

export type InvitationDeliveryResult =
  | {
      invitation: InvitationRecord;
      delivery: 'disabled';
      inviteUrl: string;
      token: string;
    }
  | {
      invitation: InvitationRecord;
      delivery: 'captured' | 'sent';
      inviteUrl: string;
    };

export async function createAndDeliverInvitation(
  input: CreateInvitationInput,
  dependencies: InvitationServiceDependencies = {},
): Promise<InvitationDeliveryResult> {
  const env = dependencies.env ?? getEnv();
  const provider = dependencies.mailProvider ?? createMailProvider(env);
  const create = dependencies.create ?? createInvitation;
  const revoke = dependencies.revoke ?? revokeInvitation;
  const created = await create(input);
  const inviteUrl = buildInvitationUrl(created.token, env);
  const message = createInvitationEmail({
    email: created.invitation.email,
    role: created.invitation.role,
    expiresAt: created.invitation.expiresAt,
    inviteUrl,
  });

  try {
    const delivery = await provider.send(message);
    if (delivery === 'disabled') {
      return { invitation: created.invitation, delivery, inviteUrl, token: created.token };
    }
    return { invitation: created.invitation, delivery, inviteUrl };
  } catch {
    // DB commit and SMTP acceptance cannot be atomic: an SMTP server may accept a
    // message before a timeout is reported, so exact-once delivery is impossible here.
    // We revoke on reported failure; a durable outbox is deferred for this low volume.
    try {
      await revoke(input.actorId, created.invitation.id);
    } catch {
      // Preserve a sanitized boundary error even if the compensating write also fails.
    }
    throw new InvitationDeliveryError();
  }
}
