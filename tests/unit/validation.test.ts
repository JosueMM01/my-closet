import { describe, expect, it } from 'vitest';
import {
  calendarEntryInputSchema,
  garmentInputSchema,
  loginSchema,
  processedImageUploadSchema,
  profileUpdateSchema,
  remoteImageMetadataSchema,
  outfitInputSchema,
  registerSchema,
  syncPullCursorPayloadSchema,
  syncPullQuerySchema,
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
    expect(parsed.favorite).toBe(false);
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

describe('metadatos de imagen', () => {
  it('valida UUID, WebP y dimensiones multipart', () => {
    expect(processedImageUploadSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      mimeType: 'image/webp',
      width: '1080',
      height: '720',
      byteSize: 1024,
    })).toMatchObject({ width: 1080, height: 720 });
    expect(() => processedImageUploadSchema.parse({
      id: 'invalid',
      mimeType: 'image/png',
      width: 2000,
      height: 1,
      byteSize: 1,
    })).toThrow();
  });

  it('rechaza binarios en metadatos remotos', () => {
    expect(remoteImageMetadataSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      mimeType: 'image/webp',
      width: null,
      height: null,
      byteSize: 100,
      remoteUrl: '/api/images/11111111-1111-4111-8111-111111111111',
      storageProvider: 'local',
      storageKey: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: 'no permitido',
    }).success).toBe(false);
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
    expect(() => registerSchema.parse({
      displayName: 'Ana',
      email: 'a@b.co',
      password: '12345678',
      invitationToken: 'corta',
    })).toThrow('La invitación no es válida');
  });
});

describe('profileUpdateSchema', () => {
  it('acepta nombre o imagen y rechaza un parche vacío', () => {
    expect(profileUpdateSchema.parse({ displayName: '  María  ' })).toEqual({ displayName: 'María' });
    expect(profileUpdateSchema.parse({ profileImageId: null })).toEqual({ profileImageId: null });
    expect(() => profileUpdateSchema.parse({})).toThrow();
  });
});

describe('sync pull schemas', () => {
  it('limita páginas y no permite mezclar cursor con since', () => {
    expect(syncPullQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
    expect(syncPullQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(syncPullQuerySchema.safeParse({
      since: '2026-08-25T00:00:00.000Z',
      cursor: 'cursor',
    }).success).toBe(false);
  });

  it('valida estrictamente el cursor interno por entidad', () => {
    const entity = { done: false, position: null };
    expect(syncPullCursorPayloadSchema.safeParse({
      since: null,
      upperBound: '2026-08-25T00:00:00.000Z',
      entities: {
        images: entity,
        garments: entity,
        outfits: entity,
        calendarEntries: entity,
        wardrobeShares: entity,
      },
    }).success).toBe(true);
    expect(syncPullCursorPayloadSchema.safeParse({
      since: null,
      upperBound: 'no-es-fecha',
      entities: {},
    }).success).toBe(false);
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
