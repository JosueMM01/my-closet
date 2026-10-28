import { describe, expect, it } from 'vitest';
import { createEmailChangedNoticeEmail } from '@/server/mail/email-change-email';
import { createPasswordResetEmail } from '@/server/mail/password-reset-email';
import { emailActionButton, transactionalEmailLayout } from '@/server/mail/transactional-layout';

describe('correos transaccionales con identidad My Closet', () => {
  const resetUrl = 'https://closet.example.test/reset-password#token=synthetic-reset-token';
  it('incluye diseño compatible, botón y enlace alternativo sin cambiar la vigencia', () => {
    const mail = createPasswordResetEmail({ email: 'owner@example.test', resetUrl });
    expect(mail.html).toContain('role="presentation"');
    expect(mail.html).toContain('background-color:#FAF8F6');
    expect(mail.html).toContain(`href="${resetUrl}"`);
    expect(mail.html).toContain('Si el botón no abre');
    expect(mail.html).toContain('30 minutos');
    expect(mail.text).toContain(resetUrl);
    expect(mail.html).not.toMatch(/<(script|img)|<link|@import/);
  });
  it('da estilo al aviso sin exponer la dirección completa ni añadir enlaces de acceso', () => {
    const mail = createEmailChangedNoticeEmail({ originalEmail: 'old@example.test', newEmail: 'new@example.test' });
    expect(mail.html).toContain('Tu correo se ha actualizado');
    expect(mail.html).toContain('role="presentation"');
    expect(mail.html).toContain('n***@example.test');
    expect(mail.html).not.toContain('new@example.test');
    expect(mail.html).not.toMatch(/href=|<script|<img/);
    expect(mail.text).toContain('n***@example.test');
  });
  it('escapa títulos, preheaders y atributos del enlace', () => {
    const html = transactionalEmailLayout({ title: '<script>', preheader: '"<img>', contentHtml: '<p>Contenido del servidor</p>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&lt;img&gt;');
    expect(html).not.toContain('<script>');
    expect(emailActionButton('<Abrir>', `${resetUrl}&next="<script>`)).toContain('&quot;&lt;script&gt;');
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', 'ftp://example.test/file'])('rechaza enlaces con esquema inseguro: %s', url => {
    expect(() => createPasswordResetEmail({ email: 'owner@example.test', resetUrl: url })).toThrow('HTTP');
  });
});
