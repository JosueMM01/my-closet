import 'server-only';
import { randomBytes } from 'node:crypto';
import { createMailProvider, type MailProvider } from '@/server/mail';
import { AccountError, findUserByEmail, type UserRecord } from '@/server/repositories/users-repository';
import { discardEmailChangeToken, hashEmailChangeToken, replaceEmailChangeToken } from '@/server/repositories/email-change-repository';

export async function requestEmailChange(
  user: UserRecord, newEmail: string, provider: MailProvider = createMailProvider(),
): Promise<boolean> {
  const duplicate = await findUserByEmail(newEmail);
  if (duplicate && duplicate.id !== user.id) {
    throw new AccountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo');
  }
  if (provider.kind === 'disabled') return false;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashEmailChangeToken(token);
  await replaceEmailChangeToken(user, newEmail, tokenHash, new Date(Date.now() + 15 * 60_000));
  try {
    const delivery = await provider.send({
      to: newEmail,
      subject: 'Confirma tu nuevo correo de My Closet',
      text: [
        'Copia este código en Cuenta y seguridad de My Closet:', '', token, '',
        'Vence en 15 minutos y solo puede usarse una vez desde la cuenta que solicitó el cambio.',
        'Tu correo actual no cambia hasta confirmar. Si no solicitaste el cambio, ignora este mensaje.',
      ].join('\n'),
      // Solo se interpola un token base64url generado por el servidor.
      html: `<p>Copia este código en Cuenta y seguridad de My Closet:</p><p><code>${token}</code></p><p>Vence en 15 minutos. Si no solicitaste el cambio, ignora este mensaje.</p>`,
    });
    if (delivery !== 'disabled') return true;
  } catch {
    // Nunca registrar el mensaje, token ni datos SMTP.
  }
  await discardEmailChangeToken(user.id, tokenHash);
  return false;
}
