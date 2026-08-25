import type { UserRole } from '@/lib/domain/types';
import type { ServerEnv } from '@/server/env';
import type { OutboundMailMessage } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildInvitationUrl(token: string, env: ServerEnv): string {
  const baseUrl =
    env.NEXT_PUBLIC_APP_URL ??
    (env.EMAIL_PROVIDER === 'disabled' || env.EMAIL_PROVIDER === 'capture'
      ? 'http://localhost:3000'
      : null);
  if (!baseUrl) throw new Error('No hay una URL pública configurada para la invitación');

  const url = new URL('/register', baseUrl);
  url.search = '';
  url.hash = `invite=${encodeURIComponent(token)}`;
  return url.toString();
}

export function createInvitationEmail(input: {
  email: string;
  role: UserRole;
  expiresAt: string;
  inviteUrl: string;
}): OutboundMailMessage {
  const role = input.role === 'ADMIN' ? 'administrador' : 'usuario';
  const expiration = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(input.expiresAt));
  const subject = 'Invitación a My Closet';
  const text = [
    'Te han invitado a My Closet.',
    '',
    `Correo: ${input.email}`,
    `Rol: ${role}`,
    `La invitación vence el ${expiration} (hora de Ciudad de México).`,
    '',
    `Completa tu registro: ${input.inviteUrl}`,
    '',
    'Si no esperabas esta invitación, puedes ignorar este mensaje.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f8f5f2;color:#292321;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f5f2;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7ddd8;border-radius:24px;overflow:hidden">
          <tr><td style="padding:30px 28px 18px;text-align:center;background:#f4e8ec">
            <p style="margin:0 0 8px;color:#8d3658;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">My Closet</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:30px;line-height:1.2;color:#392b30">Tu armario te espera</h1>
          </td></tr>
          <tr><td style="padding:26px 28px">
            <p style="margin:0 0 18px;font-size:16px;line-height:1.6">Te invitaron a organizar prendas, conjuntos y calendario en My Closet.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;background:#faf7f5;border-radius:16px">
              <tr><td style="padding:16px 18px;font-size:14px;line-height:1.8">
                <strong>Correo:</strong> ${escapeHtml(input.email)}<br>
                <strong>Rol:</strong> ${escapeHtml(role)}<br>
                <strong>Vence:</strong> ${escapeHtml(expiration)} (hora de Ciudad de México)
              </td></tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td style="border-radius:999px;background:#8d3658">
              <a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Aceptar invitación</a>
            </td></tr></table>
            <p style="margin:24px 0 8px;font-size:12px;line-height:1.6;color:#746b68">Si el botón no abre, copia este enlace en tu navegador:</p>
            <p style="margin:0;word-break:break-all;font-size:12px;line-height:1.6;color:#8d3658">${escapeHtml(input.inviteUrl)}</p>
          </td></tr>
          <tr><td style="padding:18px 28px;background:#faf7f5;border-top:1px solid #eee5e1;font-size:12px;line-height:1.6;color:#746b68">
            Este enlace es personal, vence y solo puede usarse una vez. My Closet nunca enviará una contraseña por correo. Si no esperabas esta invitación, ignora el mensaje.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { to: input.email, subject, text, html };
}
