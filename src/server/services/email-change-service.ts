import 'server-only';
import { randomInt } from 'node:crypto';
import { createMailProvider, type MailProvider } from '@/server/mail';
import { createEmailChangeCodeEmail, createEmailChangedNoticeEmail } from '@/server/mail/email-change-email';
import { AccountError, findUserByEmail, type UserRecord } from '@/server/repositories/users-repository';
import { consumeEmailChangeToken, hashEmailChangeCode, replaceEmailChangeToken } from '@/server/repositories/email-change-repository';

export const EMAIL_CHANGE_CODE_MINUTES = 10;

/** Seis digitos uniformes generados con CSPRNG; los ceros iniciales se conservan. */
export function generateEmailChangeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function requestEmailChange(
  user: UserRecord, newEmail: string, provider: MailProvider = createMailProvider(),
): Promise<boolean> {
  const duplicate = await findUserByEmail(newEmail);
  if (duplicate && duplicate.id !== user.id) {
    throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
  }
  if (provider.kind === 'disabled') return false;
  const code = generateEmailChangeCode();
  try {
    const delivery = await provider.send(createEmailChangeCodeEmail({
      newEmail, code, validMinutes: EMAIL_CHANGE_CODE_MINUTES,
    }));
    if (delivery === 'disabled') return false;
  } catch {
    // Nunca registrar el mensaje, codigo ni datos SMTP. Una entrega fallida
    // conserva la solicitud anterior porque aun no se ha reemplazado.
    return false;
  }
  await replaceEmailChangeToken(
    user, newEmail, hashEmailChangeCode(user.id, code),
    new Date(Date.now() + EMAIL_CHANGE_CODE_MINUTES * 60_000),
  );
  return true;
}

/** Confirma el cambio y avisa al buzon anterior; el aviso nunca revierte la confirmacion. */
export async function confirmEmailChange(
  userId: string, code: string, provider: MailProvider = createMailProvider(),
): Promise<string | null> {
  const confirmed = await consumeEmailChangeToken(userId, code);
  if (!confirmed) return null;
  try {
    await provider.send(createEmailChangedNoticeEmail(confirmed));
  } catch {
    // El cambio ya es durable; no registrar datos SMTP ni direcciones.
  }
  return confirmed.newEmail;
}
