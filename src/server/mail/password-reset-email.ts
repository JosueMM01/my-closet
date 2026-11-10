import type { ServerEnv } from '@/server/env';
import type { OutboundMailMessage } from './types';
import { emailActionButton, escapeEmailHtml, transactionalEmailLayout } from './transactional-layout';

export function buildPasswordResetUrl(token: string, env: ServerEnv): string {
  const baseUrl =
    env.NEXT_PUBLIC_APP_URL ??
    (env.EMAIL_PROVIDER === 'disabled' || env.EMAIL_PROVIDER === 'capture'
      ? 'http://localhost:3000'
      : null);
  if (!baseUrl) throw new Error('No hay una URL pública configurada para recuperar la contraseña');

  const url = new URL('/reset-password', baseUrl);
  url.search = '';
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

export function createPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}): OutboundMailMessage {
  const subject = 'Recupera tu contraseña de My Closet';
  const text = [
    'Recibimos una solicitud para cambiar tu contraseña de My Closet.',
    '',
    `Crea una contraseña nueva: ${input.resetUrl}`,
    '',
    'Este enlace vence en 30 minutos y solo puede usarse una vez.',
    'Si no solicitaste el cambio, puedes ignorar este mensaje.',
  ].join('\n');
  const html = transactionalEmailLayout({
    title: 'Recupera tu contraseña',
    preheader: 'Un enlace seguro para volver a tu armario. Vence en 30 minutos.',
    contentHtml: `<p style="margin:0 0 16px">Recibimos una solicitud para cambiar tu contraseña de My Closet. Puedes crear una nueva y volver a tu armario con este enlace personal.</p>
      ${emailActionButton('Crear una contraseña nueva', input.resetUrl)}
      <p style="margin:0 0 22px;padding:14px 18px;background-color:#F6F1F2;border-left:3px solid #8F5B66;border-radius:6px;color:#7A4D57;font-size:13px">Vence en <strong>30 minutos</strong> y solo puede usarse <strong>una vez</strong>.</p>
      <p style="margin:0 0 8px;font-size:12px">Si el botón no abre, copia este enlace en tu navegador:</p>
      <p style="margin:0 0 24px;font-size:12px;line-height:1.7;word-break:break-all;color:#7A4D57">${escapeEmailHtml(input.resetUrl)}</p>
      <p style="margin:0;padding-top:20px;border-top:1px solid #EAE3DE;font-size:12px">Si no solicitaste el cambio para <strong>${escapeEmailHtml(input.email)}</strong>, ignora este mensaje. Tu contraseña no cambia hasta que completes el proceso.</p>`,
  });

  return { to: input.email, subject, text, html };
}
