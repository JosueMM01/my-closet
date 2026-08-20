import { z } from 'zod';
import type { CalendarEntry, Garment, Outfit, OutfitSlot } from './types';

export const recommendationContextSchema = z
  .object({
    occasion: z.enum(['casual', 'work', 'formal', 'active']),
    temperature: z.enum(['cold', 'mild', 'warm']),
    rain: z.boolean(),
    style: z.enum(['classic', 'minimal', 'colorful']),
  })
  .strict();

export type RecommendationContext = z.infer<typeof recommendationContextSchema>;

export const DEFAULT_RECOMMENDATION_CONTEXT: RecommendationContext = {
  occasion: 'casual',
  temperature: 'mild',
  rain: false,
  style: 'minimal',
};

export interface RecommendationInput {
  userId: string;
  context: RecommendationContext;
  garments: readonly Garment[];
  outfits: readonly Outfit[];
  calendarEntries: readonly CalendarEntry[];
  variationSeed: number;
}

export interface OutfitSuggestion {
  /** Firma estable de las prendas, útil como clave de UI. */
  key: string;
  slots: OutfitSlot[];
  reasons: string[];
}

interface ScoredCandidate extends OutfitSuggestion {
  score: number;
  tieBreaker: number;
}

const CORE_CATEGORIES = new Set(['dresses', 'tops', 'bottoms', 'footwear']);
const OPTIONAL_CATEGORIES = ['outerwear', 'bags', 'accessories'] as const;
const SUPPORTED_CATEGORIES = new Set([...CORE_CATEGORIES, ...OPTIONAL_CATEGORIES]);
const NEUTRAL_COLORS = new Set(['black', 'white', 'grey', 'beige', 'brown', 'silver']);
const COLOR_GROUPS = [
  new Set(['red', 'pink', 'orange']),
  new Set(['blue', 'green', 'purple']),
];
const MAX_PER_CATEGORY = 18;
const RECENT_WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1_000;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function pairs<T>(values: readonly T[]): Array<readonly [T, T]> {
  const result: Array<readonly [T, T]> = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const first = values[left];
      const second = values[right];
      if (first !== undefined && second !== undefined) result.push([first, second]);
    }
  }
  return result;
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function colorPairScore(left: Garment, right: Garment): number {
  if (left.colors.length === 0 || right.colors.length === 0) return 0;
  let best = Number.NEGATIVE_INFINITY;
  for (const leftColor of left.colors) {
    for (const rightColor of right.colors) {
      let score = 0;
      if (leftColor === rightColor && leftColor !== 'pattern') score = 4;
      else if (leftColor === 'pattern' && rightColor === 'pattern') score = -5;
      else if (leftColor === 'pattern' || rightColor === 'pattern') {
        const solid = leftColor === 'pattern' ? rightColor : leftColor;
        score = NEUTRAL_COLORS.has(solid) ? 2 : -2;
      } else if (NEUTRAL_COLORS.has(leftColor) && NEUTRAL_COLORS.has(rightColor)) score = 3;
      else if (NEUTRAL_COLORS.has(leftColor) || NEUTRAL_COLORS.has(rightColor)) score = 2;
      else if (COLOR_GROUPS.some((group) => group.has(leftColor) && group.has(rightColor))) score = 1;
      best = Math.max(best, score);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function styleScore(garments: readonly Garment[], style: RecommendationContext['style']): number {
  const colors = garments.flatMap((garment) => garment.colors);
  if (style === 'colorful') {
    const chromatic = new Set(colors.filter((color) => !NEUTRAL_COLORS.has(color) && color !== 'pattern'));
    return Math.min(chromatic.size, 3) * 1.5;
  }
  const neutralCount = garments.filter(
    (garment) => garment.colors.length > 0 && garment.colors.every((color) => NEUTRAL_COLORS.has(color)),
  ).length;
  const patternCount = garments.filter((garment) => garment.colors.includes('pattern')).length;
  return neutralCount * (style === 'minimal' ? 1.5 : 1) - patternCount * (style === 'minimal' ? 2 : 0.5);
}

function recentPenalties(
  entries: readonly CalendarEntry[],
  outfitById: ReadonlyMap<string, Outfit>,
): Map<string, number> {
  const worn = entries
    .filter((entry) => !entry.deletedAt && entry.wornAt && outfitById.has(entry.outfitId))
    .map((entry) => ({ entry, time: Date.parse(entry.wornAt ?? '') }))
    .filter(({ time }) => Number.isFinite(time));
  let reference = Number.NEGATIVE_INFINITY;
  for (const { time } of worn) reference = Math.max(reference, time);

  const penalties = new Map<string, number>();
  if (!Number.isFinite(reference)) return penalties;
  for (const { entry, time } of worn) {
    const ageDays = Math.max(0, (reference - time) / DAY_MS);
    if (ageDays > RECENT_WINDOW_DAYS) continue;
    const penalty = ageDays <= 7 ? 12 : ageDays <= 21 ? 7 : 3;
    const outfit = outfitById.get(entry.outfitId);
    if (!outfit) continue;
    for (const garmentId of new Set(outfit.slots.map((slot) => slot.garmentId).filter((id): id is string => id !== null))) {
      penalties.set(garmentId, (penalties.get(garmentId) ?? 0) + penalty);
    }
  }
  return penalties;
}

function optionalCategories(context: RecommendationContext): typeof OPTIONAL_CATEGORIES[number][] {
  const categories: typeof OPTIONAL_CATEGORIES[number][] = [];
  if (context.temperature === 'cold' || context.rain || (context.occasion === 'formal' && context.temperature !== 'warm')) {
    categories.push('outerwear');
  }
  if (context.occasion === 'work' || context.occasion === 'formal') categories.push('bags');
  if (context.occasion === 'formal' || context.style === 'colorful') categories.push('accessories');
  return categories;
}

/**
 * Genera hasta tres combinaciones sin I/O. La lista por categoría se limita
 * antes del producto cartesiano para mantener un coste máximo constante.
 */
export function recommendOutfits(input: RecommendationInput): OutfitSuggestion[] {
  const context = recommendationContextSchema.parse(input.context);
  const seed = Number.isSafeInteger(input.variationSeed) ? input.variationSeed : 0;
  const garments = input.garments.filter(
    (garment) =>
      garment.userId === input.userId &&
      !garment.deletedAt &&
      !garment.archived &&
      SUPPORTED_CATEGORIES.has(garment.category),
  );
  const garmentById = new Map(garments.map((garment) => [garment.id, garment]));
  const outfits = input.outfits.filter((outfit) => outfit.userId === input.userId && !outfit.deletedAt);
  const outfitById = new Map(outfits.map((outfit) => [outfit.id, outfit]));
  const entries = input.calendarEntries.filter((entry) => entry.userId === input.userId);
  const penalties = recentPenalties(entries, outfitById);

  const exactPairs = new Map<string, number>();
  const categoryPairs = new Map<string, number>();
  for (const outfit of outfits) {
    const savedGarments = [...new Set(
      outfit.slots
        .map((slot) => slot.garmentId)
        .filter((id): id is string => id !== null && garmentById.has(id)),
    )].map((id) => garmentById.get(id)!).filter(Boolean);
    for (const [left, right] of pairs(savedGarments)) {
      addCount(exactPairs, pairKey(left.id, right.id));
      addCount(categoryPairs, pairKey(left.category, right.category));
    }
  }

  const byCategory = new Map<string, Garment[]>();
  for (const garment of garments) {
    const category = byCategory.get(garment.category) ?? [];
    category.push(garment);
    byCategory.set(garment.category, category);
  }
  for (const [category, categoryGarments] of byCategory) {
    categoryGarments.sort((left, right) => {
      const leftScore = (left.favorite ? 12 : 0) - (penalties.get(left.id) ?? 0);
      const rightScore = (right.favorite ? 12 : 0) - (penalties.get(right.id) ?? 0);
      return rightScore - leftScore || left.id.localeCompare(right.id);
    });
    byCategory.set(category, categoryGarments.slice(0, MAX_PER_CATEGORY));
  }

  const scoreCandidate = (base: readonly Garment[]): ScoredCandidate => {
    const selected = [...base];
    for (const category of optionalCategories(context)) {
      const candidates = byCategory.get(category) ?? [];
      let best: Garment | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        let candidateScore = (candidate.favorite ? 8 : 0) - (penalties.get(candidate.id) ?? 0);
        for (const garment of selected) {
          candidateScore += colorPairScore(candidate, garment);
          candidateScore += (exactPairs.get(pairKey(candidate.id, garment.id)) ?? 0) * 5;
        }
        candidateScore += (hash(`${seed}|optional|${candidate.id}`) % 101) / 100;
        if (candidateScore > bestScore || (candidateScore === bestScore && candidate.id.localeCompare(best?.id ?? '') < 0)) {
          best = candidate;
          bestScore = candidateScore;
        }
      }
      if (best) selected.push(best);
    }

    let score = selected.filter((garment) => garment.favorite).length * 8;
    let colorScore = 0;
    let exactPairCount = 0;
    for (const [left, right] of pairs(selected)) {
      colorScore += colorPairScore(left, right);
      exactPairCount += exactPairs.get(pairKey(left.id, right.id)) ?? 0;
      score += Math.min(categoryPairs.get(pairKey(left.category, right.category)) ?? 0, 4) * 0.5;
    }
    score += colorScore;
    score += exactPairCount * 5;
    score += styleScore(selected, context.style);
    for (const garment of selected) score -= penalties.get(garment.id) ?? 0;

    const selectedIds = new Set(selected.map((garment) => garment.id));
    const selectedCategories = new Set(selected.map((garment) => garment.category));
    const avoidedRecent = [...penalties.keys()].some((id) => {
      const garment = garmentById.get(id);
      return garment !== undefined && selectedCategories.has(garment.category);
    }) && [...selectedIds].every((id) => !penalties.has(id));
    if (avoidedRecent) score += 2;

    const hasOuterwear = selectedCategories.has('outerwear');
    if (context.temperature === 'cold' && hasOuterwear) score += 8;
    if (context.rain && hasOuterwear) score += 5;

    const signature = selected.map((garment) => garment.id).sort().join('|');
    const tieBreaker = hash(`${seed}|candidate|${signature}`);
    score += (tieBreaker % 201) / 100;

    const reasons: string[] = [];
    if (selected.some((garment) => garment.favorite)) reasons.push('incluye una favorita');
    if (exactPairCount > 0) reasons.push('recupera una combinación guardada');
    if (avoidedRecent) reasons.push('evita prendas usadas recientemente');
    if (context.temperature === 'cold' && hasOuterwear) reasons.push('añade una capa para clima frío');
    else if (context.rain && hasOuterwear) reasons.push('añade una capa porque puede llover');
    if (reasons.length < 2 && colorScore > 0) reasons.push('combina colores compatibles');
    if (reasons.length === 0) reasons.push('completa las prendas esenciales del conjunto');

    return {
      key: signature,
      slots: selected.map((garment) => ({ category: garment.category, garmentId: garment.id })),
      reasons: reasons.slice(0, 3),
      score,
      tieBreaker,
    };
  };

  const candidates: ScoredCandidate[] = [];
  const dresses = byCategory.get('dresses') ?? [];
  const tops = byCategory.get('tops') ?? [];
  const bottoms = byCategory.get('bottoms') ?? [];
  const footwear = byCategory.get('footwear') ?? [];
  for (const dress of dresses) {
    for (const shoes of footwear) candidates.push(scoreCandidate([dress, shoes]));
  }
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoes of footwear) candidates.push(scoreCandidate([top, bottom, shoes]));
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.tieBreaker - left.tieBreaker ||
      left.key.localeCompare(right.key),
  );
  const unique = new Map<string, OutfitSuggestion>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
    if (unique.size === 3) break;
  }
  return [...unique.values()];
}
