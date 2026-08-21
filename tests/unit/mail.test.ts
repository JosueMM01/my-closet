import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv } from '@/server/env';
import { createInvitationEmail, buildInvitationUrl } from '@/server/mail/invitation-email';
import { buildPasswordResetUrl, createPasswordResetEmail } from '@/server/mail/password-reset-email';
import { createMailProvider, type MailProvider, type OutboundMailMessage } from '@/server/mail';
import {
  readCapturedMessagesForTests,
  resetCapturedMessagesForTests,
} from '@/server/mail/testing';
import {
  createAndDeliverInvitation,
  InvitationDeliveryError,
} from '@/server/services/invitation-service';
import { requestPasswordReset } from '@/server/services/password-recovery-service';

const smtpMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('nodemailer', () => ({ createTransport: smtpMocks.createTransport }));

const message: OutboundMailMessage = {
  to: 'invitee@example.test',
  subject: 'Invitación',
  text: 'Texto',
  html: '<p>Texto</p>',
};

const invitation = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'invitee@example.test',
  role: 'USER' as const,
  createdBy: '11111111-1111-4111-8111-111111111111',
  expiresAt: '2030-01-01T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  acceptedBy: null,
  createdAt: '2029-01-01T00:00:00.000Z',
};

beforeEach(() => {
  resetCapturedMessagesForTests();
  smtpMocks.createTransport.mockReset();
  smtpMocks.sendMail.mockReset();
  smtpMocks.verify.mockReset();
});

describe('límite de correo', () => {
  it('disabled no captura ni carga un transporte SMTP', async () => {
    const provider = createMailProvider(parseServerEnv({ NODE_ENV: 'test' }));

    await expect(provider.send(message)).resolves.toBe('disabled');
    expect(readCapturedMessagesForTests()).toEqual([]);
    expect(smtpMocks.createTransport).not.toHaveBeenCalled();
  });

  it('capture conserva solo los 100 mensajes más recientes en memoria', async () => {
    const provider = createMailProvider(
      parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' }),
    );

    for (let index = 0; index < 105; index += 1) {
      await provider.send({ ...message, subject: `Invitación ${index}` });
    }

    const captured = readCapturedMessagesForTests();
    expect(captured).toHaveLength(100);
    expect(captured[0]?.subject).toBe('Invitación 5');
    expect(captured[99]).toMatchObject({
      from: 'My Closet <no-reply@localhost>',
      subject: 'Invitación 104',
    });
    captured[0]!.subject = 'mutado';
    expect(readCapturedMessagesForTests()[0]?.subject).toBe('Invitación 5');
    expect(smtpMocks.createTransport).not.toHaveBeenCalled();
  });

  it('configura SMTP de forma segura y no ejecuta verify', async () => {
    smtpMocks.sendMail.mockResolvedValue({ accepted: ['invitee@example.test'], rejected: [] });
    smtpMocks.createTransport.mockReturnValue({
      sendMail: smtpMocks.sendMail,
      verify: smtpMocks.verify,
    });
    const provider = createMailProvider(
      parseServerEnv({
        EMAIL_PROVIDER: 'smtp',
        EMAIL_FROM: 'My Closet <closet@gmail.com>',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'closet@gmail.com',
        SMTP_PASSWORD: 'app-password',
        NEXT_PUBLIC_APP_URL: 'https://closet.example.test',
        NODE_ENV: 'test',
      }),
    );

    expect(smtpMocks.createTransport).not.toHaveBeenCalled();
    await expect(provider.send(message)).resolves.toBe('sent');

    expect(smtpMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: 'closet@gmail.com', pass: 'app-password' },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(smtpMocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'My Closet <closet@gmail.com>',
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(smtpMocks.verify).not.toHaveBeenCalled();
  });
});

describe('correo de invitación', () => {
  it('usa un fragmento y escapa todos los valores dinámicos del HTML', () => {
    const env = parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' });
    const inviteUrl = buildInvitationUrl('token-secreto', env);
    const email = createInvitationEmail({
      email: 'atacante<script>@example.test',
      role: 'USER',
      expiresAt: '2030-01-01T00:00:00.000Z',
      inviteUrl: `${inviteUrl}&next="<script>`,
    });

    expect(inviteUrl).toBe('http://localhost:3000/register#invite=token-secreto');
    expect(inviteUrl).not.toContain('?');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('atacante&lt;script&gt;@example.test');
    expect(email.html).toContain('&amp;next=&quot;&lt;script&gt;');
    expect(email.text).toContain('Completa tu registro:');
  });
});

describe('correo de recuperación', () => {
  it('captura una URL con fragmento y entrega al repositorio solo el hash', async () => {
    const env = parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' });
    const rawToken = 'r'.repeat(43);
    const replaceToken = vi.fn(async () => undefined);

    await requestPasswordReset('owner@example.test', {
      env,
      generateToken: () => rawToken,
      replaceToken,
      findUser: async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'owner@example.test',
        displayName: 'Owner',
        passwordHash: 'stored-hash',
        role: 'USER',
        status: 'ACTIVE',
        adminSlot: null,
        profileImageId: null,
        createdAt: '2029-01-01T00:00:00.000Z',
      }),
    });

    expect(replaceToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
    expect(JSON.stringify(replaceToken.mock.calls)).not.toContain(rawToken);
    const captured = readCapturedMessagesForTests();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toContain(`/reset-password#token=${rawToken}`);
    expect(captured[0]?.text).not.toContain('/reset-password?token=');
  });

  it('construye y escapa la plantilla española', () => {
    const env = parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' });
    const resetUrl = buildPasswordResetUrl('token-seguro', env);
    const email = createPasswordResetEmail({
      email: 'owner<script>@example.test',
      resetUrl: `${resetUrl}&next="<script>`,
    });
    expect(resetUrl).toBe('http://localhost:3000/reset-password#token=token-seguro');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('30 minutos');
  });

  it('no propaga detalles cuando falla la entrega', async () => {
    const env = parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' });
    const mailProvider: MailProvider = {
      kind: 'smtp',
      send: async () => {
        throw new Error('detalle privado del transporte');
      },
    };

    await expect(
      requestPasswordReset('owner@example.test', {
        env,
        mailProvider,
        generateToken: () => 'f'.repeat(43),
        replaceToken: async () => undefined,
        findUser: async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          email: 'owner@example.test',
          displayName: 'Owner',
          passwordHash: 'stored-hash',
          role: 'USER',
          status: 'ACTIVE',
          adminSlot: null,
          profileImageId: null,
          createdAt: '2029-01-01T00:00:00.000Z',
        }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('servicio de invitaciones', () => {
  it('expone el token por separado solo cuando el correo está disabled', async () => {
    const env = parseServerEnv({ NODE_ENV: 'test' });
    const create = vi.fn(async () => ({ invitation, token: 'a'.repeat(43) }));

    const result = await createAndDeliverInvitation(
      {
        actorId: invitation.createdBy,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      { env, create },
    );

    expect(result.delivery).toBe('disabled');
    if (result.delivery !== 'disabled') throw new Error('Entrega disabled esperada');
    expect(result.token).toBe('a'.repeat(43));
    expect(result.inviteUrl).toBe(`http://localhost:3000/register#invite=${'a'.repeat(43)}`);
  });

  it('omite el campo token en capture aunque lo conserva en inviteUrl', async () => {
    const env = parseServerEnv({ EMAIL_PROVIDER: 'capture', NODE_ENV: 'test' });
    const create = vi.fn(async () => ({ invitation, token: 'b'.repeat(43) }));

    const result = await createAndDeliverInvitation(
      {
        actorId: invitation.createdBy,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      { env, create },
    );

    expect(result).toMatchObject({ delivery: 'captured' });
    expect(result.inviteUrl).toContain(`#invite=${'b'.repeat(43)}`);
    expect('token' in result).toBe(false);
  });

  it('revoca la invitación recién creada y sanitiza un fallo de envío', async () => {
    const env = parseServerEnv({ NODE_ENV: 'test' });
    const create = vi.fn(async () => ({ invitation, token: 'c'.repeat(43) }));
    const revoke = vi.fn(async () => ({ ...invitation, revokedAt: new Date().toISOString() }));
    const send = vi.fn(async () => {
      throw new Error('535 contraseña SMTP rechazada por smtp.internal.test');
    });
    const mailProvider: MailProvider = { kind: 'smtp', send };

    await expect(
      createAndDeliverInvitation(
        {
          actorId: invitation.createdBy,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
        { env, create, revoke, mailProvider },
      ),
    ).rejects.toEqual(new InvitationDeliveryError());

    expect(send).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith(invitation.createdBy, invitation.id);
    expect(revoke.mock.invocationCallOrder[0]).toBeGreaterThan(send.mock.invocationCallOrder[0]!);
  });
});
