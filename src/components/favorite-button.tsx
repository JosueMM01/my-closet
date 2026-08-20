'use client';

import { useState } from 'react';
import { toggleGarmentFavorite } from '@/lib/local/repositories';
import { HeartIcon } from './icons';

export function FavoriteButton({
  garmentId,
  favorite,
  className = '',
}: {
  garmentId: string;
  favorite: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const label = favorite ? 'Quitar de favoritas' : 'Añadir a favoritas';

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await toggleGarmentFavorite(garmentId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={label}
      aria-pressed={favorite}
      title={label}
      data-testid={`favorite-garment-${garmentId}`}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
        favorite ? 'text-primary' : 'text-text-secondary'
      } ${className}`}
    >
      <HeartIcon size={21} className={favorite ? 'fill-current' : ''} />
    </button>
  );
}
