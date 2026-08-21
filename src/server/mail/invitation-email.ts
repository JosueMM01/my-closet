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
  const subject = 'Invitación a My Closet';
  const text = [
    'Te han invitado a My Closet.',
    '',
    `Correo: ${input.email}`,
    `Rol: ${role}`,
    `La invitación vence el ${input.expiresAt}.`,
    '',
    `Completa tu registro: ${input.inviteUrl}`,
    '',
    'Si no esperabas esta invitación, puedes ignorar este mensaje.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es">
  <body>
    <h1>Te han invitado a My Closet</h1>
    <p>Usa esta invitación para crear tu cuenta.</p>
    <ul>
      <li><strong>Correo:</strong> ${escapeHtml(input.email)}</li>
      <li><strong>Rol:</strong> ${escapeHtml(role)}</li>
      <li><strong>Vence:</strong> ${escapeHtml(input.expiresAt)}</li>
    </ul>
    <p><a href="${escapeHtml(input.inviteUrl)}">Completar registro</a></p>
    <p>Si no esperabas esta invitación, puedes ignorar este mensaje.</p>
  </body>
</html>`;

  return { to: input.email, subject, text, html };
}
