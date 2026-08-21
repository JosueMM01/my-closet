import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOMMENDATION_CONTEXT,
  recommendOutfits,
  type RecommendationContext,
} from '@/lib/domain/recommendations';
import type { CalendarEntry, Garment, Outfit } from '@/lib/domain/types';

const USER = '11111111-1111-4111-8111-111111111111';
const BASE_TIME = '2026-08-20T12:00:00.000Z';

function garment(id: string, category: string, options: Partial<Garment> = {}): Garment {
  return {
    id,
    userId: USER,
    shareableId: `share-${id}`,
    name: id,
    category,
    colors: [],
    brand: null,
    size: null,
    notes: null,
    washingInstructions: null,
    dateAcquired: null,
    archived: false,
    favorite: false,
    photoId: null,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    version: 1,
    deletedAt: null,
    syncStatus: 'synced',
    ...options,
  };
}

function outfit(id: string, garmentIds: readonly string[], garments: readonly Garment[]): Outfit {
  return {
    id,
    userId: USER,
    shareableId: `share-${id}`,
    name: id,
    notes: null,
    slots: garmentIds.map((garmentId) => ({
      category: garments.find((candidate) => candidate.id === garmentId)?.category ?? 'other',
      garmentId,
    })),
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    version: 1,
    deletedAt: null,
    syncStatus: 'synced',
  };
}

function calendarEntry(id: string, outfitId: string, wornAt: string): CalendarEntry {
  return {
    id,
    userId: USER,
    date: wornAt.slice(0, 10),
    outfitId,
    wornAt,
    notes: null,
    createdAt: wornAt,
    updatedAt: wornAt,
    version: 1,
    deletedAt: null,
    syncStatus: 'synced',
  };
}

function generate(
  garments: readonly Garment[],
  options: {
    outfits?: readonly Outfit[];
    entries?: readonly CalendarEntry[];
    context?: RecommendationContext;
    seed?: number;
  } = {},
) {
  return recommendOutfits({
    userId: USER,
    garments,
    outfits: options.outfits ?? [],
    calendarEntries: options.entries ?? [],
    context: options.context ?? DEFAULT_RECOMMENDATION_CONTEXT,
    variationSeed: options.seed ?? 0,
  });
}

describe('recomendaciones de conjuntos', () => {
  it('solo devuelve recetas completas y sin prendas duplicadas', () => {
    const garments = [
      garment('dress', 'dresses'),
      garment('top', 'tops'),
      garment('bottom', 'bottoms'),
      garment('shoes', 'footwear'),
    ];
    const suggestions = generate(garments);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      const categories = suggestion.slots.map((slot) => slot.category);
      const validDress = categories.includes('dresses') && categories.includes('footwear');
      const validSeparates = ['tops', 'bottoms', 'footwear'].every((category) => categories.includes(category));
      expect(validDress || validSeparates).toBe(true);
      expect(new Set(suggestion.slots.map((slot) => slot.garmentId)).size).toBe(suggestion.slots.length);
    }
  });

  it('mantiene un ranking determinista para los mismos datos y semilla', () => {
    const garments = [
      garment('top-a', 'tops'), garment('top-b', 'tops'),
      garment('bottom-a', 'bottoms'), garment('bottom-b', 'bottoms'),
      garment('shoes-a', 'footwear'), garment('shoes-b', 'footwear'),
    ];
    expect(generate(garments, { seed: 17 })).toEqual(generate([...garments].reverse(), { seed: 17 }));
  });

  it('prioriza favoritas y explica la señal', () => {
    const garments = [
      garment('top-favorite', 'tops', { favorite: true }),
      garment('top-other', 'tops'),
      garment('bottom', 'bottoms'),
      garment('shoes', 'footwear'),
    ];
    const first = generate(garments)[0];
    expect(first?.slots.some((slot) => slot.garmentId === 'top-favorite')).toBe(true);
    expect(first?.reasons).toContain('incluye una favorita');
  });

  it('prefiere combinaciones neutrales y evita mezclar dos estampados', () => {
    const garments = [
      garment('top-pattern', 'tops', { colors: ['pattern'] }),
      garment('bottom-pattern', 'bottoms', { colors: ['pattern'] }),
      garment('bottom-black', 'bottoms', { colors: ['black'] }),
      garment('shoes-black', 'footwear', { colors: ['black'] }),
    ];
    const first = generate(garments)[0];
    expect(first?.slots.some((slot) => slot.garmentId === 'bottom-black')).toBe(true);
    expect(first?.slots.some((slot) => slot.garmentId === 'bottom-pattern')).toBe(false);
  });

  it('aplica impulso a pares guardados', () => {
    const garments = [
      garment('top-saved', 'tops'), garment('top-other', 'tops'),
      garment('bottom-saved', 'bottoms'), garment('bottom-other', 'bottoms'),
      garment('shoes', 'footwear'),
    ];
    const saved = outfit('saved', ['top-saved', 'bottom-saved'], garments);
    const first = generate(garments, { outfits: [saved] })[0];
    expect(first?.slots.map((slot) => slot.garmentId)).toEqual(
      expect.arrayContaining(['top-saved', 'bottom-saved']),
    );
    expect(first?.reasons).toContain('recupera una combinación guardada');
  });

  it('penaliza prendas usadas recientemente', () => {
    const garments = [
      garment('top-recent', 'tops'), garment('top-fresh', 'tops'),
      garment('bottom', 'bottoms'), garment('shoes', 'footwear'),
    ];
    const wornOutfit = outfit('worn', ['top-recent', 'bottom', 'shoes'], garments);
    const first = generate(garments, {
      outfits: [wornOutfit],
      entries: [calendarEntry('entry', 'worn', BASE_TIME)],
    })[0];
    expect(first?.slots.some((slot) => slot.garmentId === 'top-fresh')).toBe(true);
  });

  it('explica cuando evita por completo alternativas usadas recientemente', () => {
    const garments = [
      garment('top-recent', 'tops'), garment('top-fresh', 'tops'),
      garment('bottom-recent', 'bottoms'), garment('bottom-fresh', 'bottoms'),
      garment('shoes-recent', 'footwear'), garment('shoes-fresh', 'footwear'),
    ];
    const wornOutfit = outfit('worn-all', ['top-recent', 'bottom-recent', 'shoes-recent'], garments);
    const first = generate(garments, {
      outfits: [wornOutfit],
      entries: [calendarEntry('entry-all', 'worn-all', BASE_TIME)],
    })[0];
    expect(first?.reasons).toContain('evita prendas usadas recientemente');
    expect(first?.slots.every((slot) => !slot.garmentId?.endsWith('-recent'))).toBe(true);
  });

  it('añade abrigo en frío sin atribuir propiedades no almacenadas', () => {
    const garments = [
      garment('top', 'tops'), garment('bottom', 'bottoms'),
      garment('shoes', 'footwear'), garment('coat', 'outerwear'),
    ];
    const first = generate(garments, {
      context: { ...DEFAULT_RECOMMENDATION_CONTEXT, temperature: 'cold', rain: true },
    })[0];
    expect(first?.slots.some((slot) => slot.garmentId === 'coat')).toBe(true);
    expect(first?.reasons).toContain('añade una capa para clima frío');
    expect(first?.reasons.join(' ')).not.toMatch(/impermeable|abriga/i);
  });

  it('en contexto activo templado puede omitir abrigo', () => {
    const garments = [
      garment('top', 'tops'), garment('bottom', 'bottoms'),
      garment('shoes', 'footwear'), garment('coat', 'outerwear'),
    ];
    const first = generate(garments, {
      context: { ...DEFAULT_RECOMMENDATION_CONTEXT, occasion: 'active' },
    })[0];
    expect(first?.slots.some((slot) => slot.category === 'outerwear')).toBe(false);
  });

  it('devuelve vacío cuando el armario no completa ninguna receta', () => {
    expect(generate([garment('top', 'tops'), garment('bottom', 'bottoms')])).toEqual([]);
  });

  it('ignora prendas archivadas, eliminadas y de otras cuentas', () => {
    const garments = [
      garment('top', 'tops'),
      garment('bottom-archived', 'bottoms', { archived: true }),
      garment('bottom-other', 'bottoms', { userId: 'other-user' }),
      garment('shoes-deleted', 'footwear', { deletedAt: BASE_TIME }),
    ];
    expect(generate(garments)).toEqual([]);
  });
});
