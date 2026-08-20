/**
 * Consultas derivadas sobre la base local (filtros, contadores).
 */
import type { CalendarEntry, Garment, Outfit } from '@/lib/domain/types';

export interface WardrobeFilters {
  keyword: string;
  category: string | null;
  color: string | null;
  size: string | null;
  brand: string | null;
  showArchived: boolean;
  favoriteOnly: boolean;
}

export const EMPTY_FILTERS: WardrobeFilters = {
  keyword: '',
  category: null,
  color: null,
  size: null,
  brand: null,
  showArchived: false,
  favoriteOnly: false,
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function filterGarments(garments: Garment[], filters: WardrobeFilters): Garment[] {
  const keyword = normalize(filters.keyword.trim());
  return garments.filter((garment) => {
    if (garment.deletedAt) return false;
    if (!filters.showArchived && garment.archived) return false;
    if (filters.showArchived && !garment.archived) return false;
    if (filters.favoriteOnly && !garment.favorite) return false;
    if (filters.category && garment.category !== filters.category) return false;
    if (filters.color && !garment.colors.includes(filters.color)) return false;
    if (filters.size && garment.size !== filters.size) return false;
    if (filters.brand && garment.brand !== filters.brand) return false;
    if (keyword) {
      const haystack = normalize(
        [garment.name ?? '', garment.brand ?? '', garment.notes ?? '', garment.category].join(' '),
      );
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

/** Valores de filtro deducidos del contenido real (como Libre Closet). */
export function availableFilterOptions(garments: Garment[]) {
  const active = garments.filter((g) => !g.deletedAt);
  const categories = [...new Set(active.map((g) => g.category))].sort();
  const colors = [...new Set(active.flatMap((g) => g.colors))].sort();
  const sizes = [...new Set(active.map((g) => g.size).filter((s): s is string => Boolean(s)))];
  const brands = [...new Set(active.map((g) => g.brand).filter((b): b is string => Boolean(b)))].sort();
  return { categories, colors, sizes, brands };
}

export function activeFilterCount(filters: WardrobeFilters): number {
  let count = 0;
  if (filters.keyword.trim()) count++;
  if (filters.category) count++;
  if (filters.color) count++;
  if (filters.size) count++;
  if (filters.brand) count++;
  if (filters.favoriteOnly) count++;
  return count;
}

/** Estadísticas del home. */
export function wardrobeStats(garments: Garment[], outfits: Outfit[], entries: CalendarEntry[]) {
  const active = garments.filter((g) => !g.deletedAt && !g.archived);
  const archived = garments.filter((g) => !g.deletedAt && g.archived);
  const byCategory = new Map<string, number>();
  for (const garment of active) {
    byCategory.set(garment.category, (byCategory.get(garment.category) ?? 0) + 1);
  }
  const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  const wornCount = entries.filter((e) => !e.deletedAt && e.wornAt).length;
  return {
    totalGarments: active.length,
    archived: archived.length,
    totalOutfits: outfits.filter((o) => !o.deletedAt).length,
    wornCount,
    topCategory: topCategory ? { category: topCategory[0], count: topCategory[1] } : null,
  };
}
