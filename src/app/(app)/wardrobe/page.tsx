'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import {
  activeFilterCount,
  availableFilterOptions,
  EMPTY_FILTERS,
  filterGarments,
  type WardrobeFilters,
} from '@/lib/local/queries';
import { CATEGORY_LABELS, COLOR_HEX, COLOR_LABELS } from '@/lib/domain/constants';
import { GarmentCard } from '@/components/garment-card';
import { ArchiveIcon, HangerIcon, PlusIcon, SearchIcon } from '@/components/icons';
import { Button, Chip, EmptyState, TextInput } from '@/components/ui';

export default function WardrobePage() {
  const { profile } = useSession();
  const [filters, setFilters] = useState<WardrobeFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const garments = useLiveQuery(
    async () => (profile ? getDB().garments.where('userId').equals(profile.userId).toArray() : []),
    [profile?.userId],
  );

  const options = useMemo(() => availableFilterOptions(garments ?? []), [garments]);
  const filtered = useMemo(() => filterGarments(garments ?? [], filters), [garments, filters]);
  const filterCount = activeFilterCount(filters);

  const hasAny = (garments ?? []).some((g) => !g.deletedAt);

  function update(patch: Partial<WardrobeFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-text-primary">Armario</h1>
          <p className="mt-1 text-sm text-text-secondary" data-testid="wardrobe-count">
            {filtered.length} {filtered.length === 1 ? 'prenda' : 'prendas'}
          </p>
        </div>
        <div className="flex gap-3 text-text-primary">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Filtros"
            data-testid="wardrobe-filters-toggle"
            className="flex items-center justify-center relative hover:text-primary transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            {filterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary" />
            )}
          </button>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="mb-5 relative">
        <SearchIcon
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <TextInput
          type="search"
          placeholder="Buscar en mi armario"
          value={filters.keyword}
          onChange={(e) => update({ keyword: e.target.value })}
          className="pl-12 bg-surface-alt border-transparent rounded-full h-12 shadow-none focus:bg-surface focus:border-border"
          aria-label="Buscar prendas"
          data-testid="wardrobe-search"
        />
      </div>

      {/* Quick category pills */}
      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        <Chip
          active={!filters.category}
          onClick={() => update({ category: null })}
          className={!filters.category ? '!bg-primary !text-white !border-primary' : '!border-transparent !bg-surface-alt'}
        >
          Todas
        </Chip>
        <Chip
          active={filters.favoriteOnly}
          onClick={() => update({ favoriteOnly: !filters.favoriteOnly })}
          className={filters.favoriteOnly ? '!bg-primary !text-white !border-primary' : '!border-transparent !bg-surface-alt'}
        >
          Favoritas
        </Chip>
        {options.categories.map((category) => (
          <Chip
            key={category}
            active={filters.category === category}
            onClick={() => update({ category: filters.category === category ? null : category })}
            className={filters.category === category ? '!bg-primary !text-white !border-primary' : '!border-transparent !bg-surface-alt'}
          >
            {CATEGORY_LABELS[category] ?? category}
          </Chip>
        ))}
      </div>

      {/* Panel de filtros avanzado */}
      {showFilters && (
        <div className="card-surface mb-6 space-y-4 p-5 rounded-2xl" data-testid="wardrobe-filters-panel">
          {options.colors.length > 0 && (
            <FilterRow label="Color">
              <Chip active={!filters.color} onClick={() => update({ color: null })}>
                Todos
              </Chip>
              {options.colors.map((color) => (
                <Chip
                  key={color}
                  active={filters.color === color}
                  onClick={() => update({ color: filters.color === color ? null : color })}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-border"
                    style={{ background: COLOR_HEX[color] ?? '#A79F99' }}
                    aria-hidden
                  />
                  {COLOR_LABELS[color] ?? color}
                </Chip>
              ))}
            </FilterRow>
          )}

          {options.brands.length > 0 && (
            <FilterRow label="Marca">
              <Chip active={!filters.brand} onClick={() => update({ brand: null })}>
                Todas
              </Chip>
              {options.brands.map((brand) => (
                <Chip
                  key={brand}
                  active={filters.brand === brand}
                  onClick={() => update({ brand: filters.brand === brand ? null : brand })}
                >
                  {brand}
                </Chip>
              ))}
            </FilterRow>
          )}

          <FilterRow label="Estado">
            <Chip
              active={!filters.showArchived}
              onClick={() => update({ showArchived: false })}
            >
              Activas
            </Chip>
            <Chip
              active={filters.showArchived}
              onClick={() => update({ showArchived: true })}
            >
              <ArchiveIcon size={14} />
              Archivadas
            </Chip>
          </FilterRow>

          {filterCount > (filters.category ? 1 : 0) && (
            <button
              type="button"
              onClick={() => setFilters({
                ...EMPTY_FILTERS,
                showArchived: filters.showArchived,
                category: filters.category,
                favoriteOnly: filters.favoriteOnly,
              })}
              className="text-sm font-semibold text-primary hover:text-primary-hover"
            >
              Limpiar filtros adicionales
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {garments === undefined ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-surface aspect-[4/5] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : !hasAny ? (
        <EmptyState
          icon={<HangerIcon size={32} />}
          title="Tu armario está vacío"
          description="Añade tu primera prenda para empezar a crear conjuntos."
          action={
            <Link href="/wardrobe/new">
              <Button data-testid="empty-add-garment">
                <PlusIcon size={18} />
                Añadir prenda
              </Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={32} />}
          title="Sin resultados"
          description="Prueba con otra búsqueda o quita algunos filtros."
        />
      ) : (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="wardrobe-grid"
        >
          {filtered.map((garment) => (
            <GarmentCard key={garment.id} garment={garment} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}
