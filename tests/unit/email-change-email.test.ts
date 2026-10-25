import { describe, expect, it } from 'vitest';
import { createEmailChangeCodeEmail, createEmailChangedNoticeEmail, formatEmailChangeCode } from '@/server/mail/email-change-email';

describe('correo de verificación de My Closet', () => {
  it('muestra seis dígitos con guiones en HTML y texto, conservando ceros iniciales', () => {
    const message = createEmailChangeCodeEmail({ newEmail: 'test@example.test', code: '012345', validMinutes: 10 });
    expect(message.to).toBe('test@example.test');
    expect(message.text).toContain('\n0-1-2-3-4-5\n');
    expect(message.html).toContain('0-1-2-3-4-5');
    expect(message.html).toContain('10 minutos');
    expect(message.html).toContain('5 intentos fallidos');
    expect(message.html).toContain('role="presentation"');
    expect(message.html).not.toMatch(/<(script|img)|https?:\/\//);
  });
  it.each(['12345', '1234567', '12a456', '<img>'])('rechaza un código inválido: %s', code => {
    expect(() => formatEmailChangeCode(code)).toThrow('6 dígitos');
  });
  it('el aviso al buzón anterior enmascara y escapa la dirección nueva', () => {
    const message = createEmailChangedNoticeEmail({ originalEmail: 'old@example.test', newEmail: 'new@example.test' });
    expect(message.to).toBe('old@example.test');
    expect(message.html).toContain('n***@example.test');
    expect(message.html).not.toContain('new@example.test');
  });
});
