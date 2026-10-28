import type { OutboundMailMessage } from './types';
import { escapeEmailHtml, transactionalEmailLayout } from './transactional-layout';

/** Oculta la parte local para no exponer el correo nuevo completo al buzon anterior. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function formatEmailChangeCode(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('El código debe tener 6 dígitos');
  return code;
}

export function createEmailChangeCodeEmail(input: {
  newEmail: string;
  code: string;
  validMinutes: number;
}): OutboundMailMessage {
  const formattedCode = formatEmailChangeCode(input.code);
  const subject = 'Confirma tu nuevo correo de My Closet';
  const text = [
    'Tu código para confirmar el nuevo correo de My Closet es:',
    '',
    formattedCode,
    '',
    `Vence en ${input.validMinutes} minutos y solo puede usarse una vez desde la cuenta que solicitó el cambio.`,
    'Tu correo actual no cambia hasta confirmar. Si no solicitaste el cambio, ignora este mensaje.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background-color:#FAF8F6;color:#1A1A1A;font-family:Verdana,Geneva,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Tu código de My Closet vence en ${input.validMinutes} minutos.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F6">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid #EAE3DE;border-radius:16px">
          <tr><td style="padding:32px 24px 12px;border-top:4px solid #8F5B66">
            <p style="margin:0 0 28px;color:#8F5B66;font-size:13px;font-weight:bold;letter-spacing:2px">MY CLOSET</p>
            <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:28px;line-height:1.25">Confirma tu nuevo correo</h1>
            <p style="margin:0;color:#6B6562;font-size:14px;line-height:1.7">Copia este código en <strong>Cuenta y seguridad</strong> para confirmar que este buzón es tuyo.</p>
          </td></tr>
          <tr><td align="center" style="padding:20px 24px">
            <div aria-label="Código de verificación" style="padding:20px 8px;background-color:#F6F1F2;border:1px solid #EAE3DE;border-radius:12px;font-family:'Courier New',monospace;font-size:28px;font-weight:bold;line-height:1.5;color:#7A4D57;white-space:nowrap">${formattedCode}</div>
          </td></tr>
          <tr><td style="padding:0 24px 32px">
            <p style="margin:0 0 16px;font-size:13px;line-height:1.7;color:#6B6562">Vence en <strong>${input.validMinutes} minutos</strong>. Solo puede usarse una vez. Tras <strong>5 intentos fallidos</strong>, deberás solicitar otro.</p>
            <p style="margin:0;padding-top:16px;border-top:1px solid #EAE3DE;font-size:12px;line-height:1.7;color:#6B6562">Tu correo actual no cambia hasta confirmar. No compartas este código. Si no solicitaste el cambio, ignora este mensaje.</p>
          </td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:11px;color:#9E9692">My Closet · Cuenta y seguridad</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { to: input.newEmail, subject, text, html };
}

export function createEmailChangedNoticeEmail(input: {
  originalEmail: string;
  newEmail: string;
}): OutboundMailMessage {
  const masked = maskEmail(input.newEmail);
  const subject = 'El correo de tu cuenta de My Closet cambió';
  const text = [
    `El correo de tu cuenta de My Closet se cambió a ${masked}.`,
    'Se cerraron las sesiones abiertas y los enlaces de recuperación anteriores.',
    '',
    'Si no hiciste este cambio, contacta de inmediato a la persona administradora de My Closet.',
  ].join('\n');
  const html = transactionalEmailLayout({
    title: 'Tu correo se ha actualizado',
    preheader: 'Confirmación de seguridad: el correo de tu cuenta cambió.',
    contentHtml: `<p style="margin:0 0 20px">El cambio de correo de tu cuenta de My Closet se completó. Esta es una confirmación para tu dirección anterior.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;background-color:#F6F1F2;border:1px solid #EAE3DE;border-radius:12px"><tr><td style="padding:18px 20px">
        <p style="margin:0 0 6px;color:#7A4D57;font-size:10px;font-weight:bold;letter-spacing:2px">NUEVA DIRECCIÓN</p>
        <p style="margin:0;color:#24201F;font-size:18px;font-weight:bold;word-break:break-word">${escapeEmailHtml(masked)}</p>
      </td></tr></table>
      <p style="margin:0 0 22px">Por seguridad, se cerraron las sesiones anteriores y se anularon los enlaces de recuperación previos.</p>
      <p style="margin:0;padding-top:20px;border-top:1px solid #EAE3DE"><strong style="color:#7A4D57">¿No hiciste este cambio?</strong><br>Contacta de inmediato a la persona administradora de My Closet. No respondas con tu contraseña ni con códigos de verificación.</p>`,
  });

  return { to: input.originalEmail, subject, text, html };
}
