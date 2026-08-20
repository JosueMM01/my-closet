'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { Garment } from '@/lib/domain/types';
import { CATEGORY_LABELS, COLOR_LABELS } from '@/lib/domain/constants';
import { GarmentPhoto } from './garment-photo';
import { FavoriteButton } from './favorite-button';

export function GarmentCard({ garment }: { garment: Garment }) {
  const categoryLabel = CATEGORY_LABELS[garment.category] ?? garment.category.charAt(0).toUpperCase() + garment.category.slice(1);
  const colorLabel = garment.colors.length > 0 ? (COLOR_LABELS[garment.colors[0]!] ?? garment.colors[0]) : categoryLabel;

  return (
    <article className="group relative" data-testid="garment-card">
      <Link href={`/wardrobe/${garment.id}`} className="block">
        <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-alt relative mb-3">
          <GarmentPhoto
            imageId={garment.photoId}
            alt={garment.name ?? categoryLabel}
            rounded="rounded-2xl"
            className={clsx(
              'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
              garment.archived && 'opacity-50',
            )}
            iconSize={32}
          />
        </div>
        <div className="px-1 pr-10">
          <p className="truncate text-[13px] font-semibold text-text-primary">
            {garment.name ?? 'Sin nombre'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-muted capitalize">
            {colorLabel}
          </p>
          {garment.archived && (
            <span className="mt-1.5 inline-block rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Archivada
            </span>
          )}
        </div>
      </Link>
      <FavoriteButton
        garmentId={garment.id}
        favorite={garment.favorite}
        className="absolute -right-1 -bottom-1 hover:bg-primary-soft"
      />
    </article>
  );
}
