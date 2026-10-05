import { describe, expect, it } from 'vitest';
import { googleFailureMessage, googleFailureReasonSchema } from '@/lib/auth/google-feedback';

describe('Errores públicos de Google', () => {
  it('no genera un error si no hay resultado de OAuth', () => {
    expect(googleFailureMessage(null)).toBeNull();
    expect(googleFailureMessage(undefined)).toBeNull();
  });
  it.each(googleFailureReasonSchema.options)('ofrece un mensaje español para %s', (reason) => {
    expect(googleFailureMessage(reason)).toEqual(expect.any(String));
    expect(googleFailureMessage(reason)!.length).toBeGreaterThan(20);
  });
  it('explica vinculación/activación, sin afirmar que un correo no existe', () => {
    const message = googleFailureMessage('account-unavailable');
    expect(message).toContain('cuenta activa vinculada');
    expect(message).toContain('contraseña');
    expect(message).not.toContain('correo no existe');
  });
  it.each(['<script>alert(1)</script>', 'token=private-fixture', { error: 'raw-internal-error' }, '', 42])(
    'nunca muestra contenido arbitrario de query o error', (value) => {
      expect(googleFailureMessage(value)).toBe(googleFailureMessage('denied'));
    },
  );
});
