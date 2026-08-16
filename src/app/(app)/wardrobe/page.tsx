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
import { CATEGORY_LABELS, COLOR_HEX, COLOR_LABELS, SIZE_LABELS } from '@/lib/domain/constants';
import { GarmentCard } from '@/components/garment-card';
import { ArchiveIcon, HangerIcon, PlusIcon, SearchIcon, XIcon } from '@/components/icons';
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
      {/* Búsqueda + toggle filtros */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <TextInput
            type="search"
            placeholder="Buscar por nombre, marca, nota…"
            value={filters.keyword}
            onChange={(e) => update({ keyword: e.target.value })}
            className="pl-10"
            aria-label="Buscar prendas"
            data-testid="wardrobe-search"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-label="Filtros"
          data-testid="wardrobe-filters-toggle"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text-secondary hover:bg-surface-alt"
        >
          <span className="relative">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {filterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                {filterCount}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Panel de filtros */}
      {showFilters && (
        <div className="card-surface mb-4 space-y-4 p-4" data-testid="wardrobe-filters-panel">
          <FilterRow label="Categoría">
            <Chip
              active={!filters.category}
              onClick={() => update({ category: null })}
            >
              Todas
            </Chip>
            {options.categories.map((category) => (
              <Chip
                key={category}
                active={filters.category === category}
                onClick={() =>
                  update({ category: filters.category === category ? null : category })
                }
              >
                {CATEGORY_LABELS[category] ?? category}
              </Chip>
            ))}
          </FilterRow>

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

          {options.sizes.length > 0 && (
            <FilterRow label="Talla">
              <Chip active={!filters.size} onClick={() => update({ size: null })}>
                Todas
              </Chip>
              {options.sizes.map((size) => (
                <Chip
                  key={size}
                  active={filters.size === size}
                  onClick={() => update({ size: filters.size === size ? null : size })}
                >
                  {SIZE_LABELS[size] ?? size}
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

          {filterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters({ ...EMPTY_FILTERS, showArchived: filters.showArchived })}
              className="text-sm font-semibold text-primary hover:text-primary-hover"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Pills activos */}
      {filterCount > 0 && (
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
          {filters.category && (
            <ActivePill
              label={CATEGORY_LABELS[filters.category] ?? filters.category}
              onRemove={() => update({ category: null })}
            />
          )}
          {filters.color && (
            <ActivePill
              label={COLOR_LABELS[filters.color] ?? filters.color}
              onRemove={() => update({ color: null })}
            />
          )}
          {filters.size && (
            <ActivePill
              label={SIZE_LABELS[filters.size] ?? filters.size!}
              onRemove={() => update({ size: null })}
            />
          )}
          {filters.brand && (
            <ActivePill label={filters.brand} onRemove={() => update({ brand: null })} />
          )}
        </div>
      )}

      {/* Contador */}
      <p className="mb-3 text-sm text-text-secondary" data-testid="wardrobe-count">
        {filtered.length} {filtered.length === 1 ? 'prenda' : 'prendas'}
      </p>

      {/* Grid */}
      {garments === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-surface aspect-[4/6] animate-pulse" />
          ))}
        </div>
      ) : !hasAny ? (
        <EmptyState
          icon={<HangerIcon size={28} />}
          title="Tu armario está vacío"
          description="Añade tu primera prenda para empezar a crear outfits y planificarlos en el calendario."
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
          icon={<SearchIcon size={28} />}
          title="Sin resultados"
          description="Prueba con otra búsqueda o quita algunos filtros."
        />
      ) : (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
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

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary-soft pl-3 pr-1.5 text-xs font-semibold text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Quitar filtro ${label}`}
        className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/15"
      >
        <XIcon size={12} />
      </button>
    </span>
  );
}
