import { describe, expect, it } from 'vitest';
import { adminCapacityMessage, isPendingInvitation, reservedAdminSeats } from '@/lib/domain/admin-capacity';

describe('reservas de plazas ADMIN', () => {
  const now = Date.parse('2026-10-04T06:00:00Z');
  const pending = { role: 'ADMIN' as const, acceptedAt: null, revokedAt: null, expiresAt: new Date(now + 1_000).toISOString() };
  it('solo cuenta ADMIN pendientes y vigentes, incluso en el instante de caducidad', () => {
    expect(reservedAdminSeats([
      pending, { ...pending, role: 'USER' }, { ...pending, acceptedAt: new Date(now).toISOString() },
      { ...pending, revokedAt: new Date(now).toISOString() }, { ...pending, expiresAt: new Date(now).toISOString() },
      { ...pending, expiresAt: 'fecha-no-válida' },
    ], now)).toBe(1);
    expect(isPendingInvitation(pending, now + 1_000)).toBe(false);
    expect(reservedAdminSeats([pending], now + 1_000)).toBe(0);
  });
  it('diferencia dos activos de una plaza reservada y explica cómo liberarla', () => {
    expect(adminCapacityMessage(2)).toContain('dos administradores activos');
    expect(adminCapacityMessage(1)).toContain('Revoca una invitación ADMIN');
  });
});
