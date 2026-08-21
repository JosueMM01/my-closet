import 'server-only';

import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { getEnv, type ServerEnv } from '@/server/env';
import { appendCapturedMessage } from './capture-store';
import type { MailProvider, OutboundMailMessage } from './types';

const LOCAL_FROM = 'My Closet <no-reply@localhost>';

class DisabledMailProvider implements MailProvider {
  readonly kind = 'disabled' as const;

  async send(): Promise<'disabled'> {
    return 'disabled';
  }
}

class CaptureMailProvider implements MailProvider {
  readonly kind = 'capture' as const;

  constructor(private readonly from: string) {}

  async send(message: OutboundMailMessage): Promise<'captured'> {
    appendCapturedMessage({
      ...message,
      from: this.from,
      capturedAt: new Date().toISOString(),
    });
    return 'captured';
  }
}

class SmtpMailProvider implements MailProvider {
  readonly kind = 'smtp' as const;

  constructor(private readonly env: ServerEnv) {}

  async send(message: OutboundMailMessage): Promise<'sent'> {
    const { EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } =
      this.env;
    if (
      !EMAIL_FROM ||
      !SMTP_HOST ||
      SMTP_PORT === undefined ||
      SMTP_SECURE === undefined ||
      !SMTP_USER ||
      !SMTP_PASSWORD
    ) {
      throw new Error('La configuración SMTP validada está incompleta');
    }

    const options = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      logger: false,
      debug: false,
      transactionLog: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      dnsTimeout: 10_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    } satisfies SMTPTransport.Options;

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport(options);
    const result = await transporter.sendMail({
      ...message,
      from: EMAIL_FROM,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (result.accepted.length === 0 || result.rejected.length > 0) {
      throw new Error('El servidor SMTP rechazó el destinatario');
    }
    return 'sent';
  }
}

export function createMailProvider(env: ServerEnv = getEnv()): MailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'capture':
      return new CaptureMailProvider(env.EMAIL_FROM ?? LOCAL_FROM);
    case 'smtp':
      return new SmtpMailProvider(env);
    default:
      return new DisabledMailProvider();
  }
}

export type { CapturedMailMessage, MailDelivery, MailProvider, OutboundMailMessage } from './types';
