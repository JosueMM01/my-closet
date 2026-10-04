import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLegalContact } from '../../src/lib/legal-config';
import { LegalContact } from '../../src/components/legal-contact';

afterEach(() => vi.unstubAllEnvs());

describe('Contacto público de privacidad', () => {
  it('permanece en revisión sin datos del responsable', () => {
    expect(parseLegalContact({})).toEqual({ ready: false });
  });
  it('requiere ambos campos para preparar publicación', () => {
    expect(parseLegalContact({ operatorName: 'Responsable de prueba' }).ready).toBe(false);
    expect(parseLegalContact({ contactEmail: 'contact@example.com' }).ready).toBe(false);
  });
  it('acepta y normaliza únicamente los datos deliberadamente públicos', () => {
    expect(parseLegalContact({ operatorName: '  Responsable de prueba  ', contactEmail: 'contact@example.com' }))
      .toEqual({ operatorName: 'Responsable de prueba', contactEmail: 'contact@example.com', ready: true });
  });
  it('ignora variables de administrador y SMTP en vez de publicarlas', () => {
    expect(parseLegalContact({ BOOTSTRAP_ADMIN_EMAIL: 'private@example.com', SMTP_USER: 'private@example.com' }))
      .toEqual({ ready: false });
  });
  it('trata campos vacíos como no configurados', () => {
    expect(parseLegalContact({ operatorName: ' ', contactEmail: '' })).toEqual({ operatorName: undefined, contactEmail: undefined, ready: false });
  });
  it('rechaza correos inválidos sin incluir su valor en el error', () => {
    expect(() => parseLegalContact({ operatorName: 'Responsable', contactEmail: 'invalid-private-value' }))
      .toThrow('Configuración legal pública inválida');
    try {
      parseLegalContact({ contactEmail: 'invalid-private-value' });
    } catch (error) {
      expect(String(error)).not.toContain('invalid-private-value');
    }
  });
  it('renderiza contacto público con enlace mailto y escapa texto del responsable', () => {
    vi.stubEnv('PUBLIC_LEGAL_OPERATOR_NAME', '<script>Responsable</script>');
    vi.stubEnv('PUBLIC_LEGAL_CONTACT_EMAIL', 'contact@example.com');
    const html = renderToStaticMarkup(createElement(LegalContact));
    expect(html).toContain('mailto:contact@example.com');
    expect(html).toContain('&lt;script&gt;Responsable&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('pendientes de confirmación');
  });
  it('sin contacto explícito renderiza revisión, no datos privados del entorno', () => {
    vi.stubEnv('PUBLIC_LEGAL_OPERATOR_NAME', '');
    vi.stubEnv('PUBLIC_LEGAL_CONTACT_EMAIL', '');
    vi.stubEnv('SMTP_USER', 'private@example.com');
    const html = renderToStaticMarkup(createElement(LegalContact));
    expect(html).toContain('pendientes de confirmación');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('mailto:');
  });
  it('publica los datos aprobados cuando no existen overrides públicos', () => {
    vi.stubEnv('PUBLIC_LEGAL_OPERATOR_NAME', undefined);
    vi.stubEnv('PUBLIC_LEGAL_CONTACT_EMAIL', undefined);
    vi.stubEnv('SMTP_USER', 'private@example.com');
    const html = renderToStaticMarkup(createElement(LegalContact));
    expect(html).toContain('Josue Martinez');
    expect(html).toContain('mailto:contacto@josuem01.dev');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('pendientes de confirmación');
  });
});
