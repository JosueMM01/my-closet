import { describe, expect, it } from 'vitest';
import {
  calendarEntryInputSchema,
  garmentInputSchema,
  loginSchema,
  outfitInputSchema,
  registerSchema,
} from '@/lib/domain/validation';
import { normalizeSize } from '@/lib/domain/constants';
import { startOfWeek, toDateOnly, weekDays } from '@/lib/domain/dates';

describe('garmentInputSchema', () => {
  it('acepta un input válido y normaliza strings vacíos a null', () => {
    const parsed = garmentInputSchema.parse({
      name: '  Blusa lino  ',
      category: 'tops',
      colors: ['White'],
      brand: '',
      size: null,
      notes: '',
      washingInstructions: 'Lavar a mano',
      dateAcquired: '2026-02-01',
      archived: false,
      photoId: null,
    });
    expect(parsed.name).toBe('Blusa lino');
    expect(parsed.brand).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.washingInstructions).toBe('Lavar a mano');
  });

  it('rechaza categoría vacía', () => {
    expect(() =>
      garmentInputSchema.parse({ name: null, category: '', colors: [] }),
    ).toThrow();
  });

  it('rechaza más colores de lo permitido', () => {
    expect(() =>
      garmentInputSchema.parse({
        name: null,
        category: 'tops',
        colors: Array.from({ length: 9 }, (_, i) => `c${i}`),
      }),
    ).toThrow();
  });
});

describe('outfitInputSchema', () => {
  it('preserva el orden y duplicados de categorías en slots', () => {
    const parsed = outfitInputSchema.parse({
      name: 'Otoño',
      notes: null,
      slots: [
        { category: 'tops', garmentId: null },
        { category: 'tops', garmentId: '11111111-1111-4111-8111-111111111111' },
        { category: 'footwear', garmentId: null },
      ],
    });
    expect(parsed.slots.map((s) => s.category)).toEqual(['tops', 'tops', 'footwear']);
  });
});

describe('calendarEntryInputSchema', () => {
  it('valida fecha YYYY-MM-DD', () => {
    expect(() =>
      calendarEntryInputSchema.parse({
        date: '02/02/2026',
        outfitId: '11111111-1111-4111-8111-111111111111',
        notes: null,
        wornAt: null,
      }),
    ).toThrow();
  });
});

describe('registerSchema / loginSchema', () => {
  it('rechaza email inválido y contraseñas cortas', () => {
    expect(() =>
      registerSchema.parse({ displayName: 'Ana', email: 'no-email', password: '12345678' }),
    ).toThrow();
    expect(() =>
      registerSchema.parse({ displayName: 'Ana', email: 'a@b.co', password: 'corta' }),
    ).toThrow();
    expect(
      loginSchema.parse({ email: 'a@b.co', password: 'secreta' }),
    ).toEqual({ email: 'a@b.co', password: 'secreta' });
  });
});

describe('normalizeSize', () => {
  it('normaliza alias comunes', () => {
    expect(normalizeSize('2xl')).toBe('XX-Large');
    expect(normalizeSize('m')).toBe('Medium');
    expect(normalizeSize('xl')).toBe('X-Large');
    expect(normalizeSize('Large')).toBe('Large');
  });

  it('conserva tallas libres no reconocidas', () => {
    expect(normalizeSize('42')).toBe('42');
  });
});

describe('dates', () => {
  it('startOfWeek devuelve lunes', () => {
    const sunday = new Date(2026, 1, 8); // domingo 8 feb 2026
    const monday = startOfWeek(sunday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(2);
  });

  it('weekDays devuelve 7 días consecutivos lunes→domingo', () => {
    const days = weekDays(new Date(2026, 1, 5));
    expect(days).toHaveLength(7);
    expect(days[0]!.getDay()).toBe(1);
    expect(days[6]!.getDay()).toBe(0);
    expect(toDateOnly(days[1]!)).toBe('2026-02-03');
  });
});
