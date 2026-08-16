'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { Garment } from '@/lib/domain/types';
import { CATEGORY_LABELS, COLOR_HEX } from '@/lib/domain/constants';
import { GarmentPhoto } from './garment-photo';

export function GarmentCard({ garment }: { garment: Garment }) {
  const label =
    CATEGORY_LABELS[garment.category] ?? garment.category.charAt(0).toUpperCase() + garment.category.slice(1);

  return (
    <Link
      href={`/wardrobe/${garment.id}`}
      data-testid="garment-card"
      className="card-surface group block overflow-hidden transition-shadow hover:shadow-card"
    >
      <div className="aspect-[4/5] w-full overflow-hidden">
        <GarmentPhoto
          imageId={garment.photoId}
          alt={garment.name ?? label}
          rounded="rounded-none"
          className={clsx(
            'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
            garment.archived && 'opacity-50',
          )}
          iconSize={32}
        />
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-text-primary">
          {garment.name ?? 'Sin nombre'}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-secondary">{label}</span>
          {garment.colors.length > 0 && (
            <span className="flex shrink-0 gap-1" aria-label={`Colores: ${garment.colors.join(', ')}`}>
              {garment.colors.slice(0, 3).map((color) => (
                <span
                  key={color}
                  className="h-3 w-3 rounded-full border border-border"
                  style={{ background: COLOR_HEX[color] ?? '#A79F99' }}
                />
              ))}
            </span>
          )}
        </div>
        {garment.archived && (
          <span className="mt-1.5 inline-block rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Archivada
          </span>
        )}
      </div>
    </Link>
  );
}
