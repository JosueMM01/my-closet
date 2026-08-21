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
  const html = `<!doctype html>
<html lang="es">
  <body>
    <h1>Recupera tu contraseña</h1>
    <p>Recibimos una solicitud para cambiar tu contraseña de My Closet.</p>
    <p><a href="${escapeHtml(input.resetUrl)}">Crear una contraseña nueva</a></p>
    <p>Este enlace vence en 30 minutos y solo puede usarse una vez.</p>
    <p>Si no solicitaste el cambio para ${escapeHtml(input.email)}, puedes ignorar este mensaje.</p>
  </body>
</html>`;

  return { to: input.email, subject, text, html };
}
