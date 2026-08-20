'use client';

import { GarmentPhoto } from './garment-photo';

export function ProfileAvatar({
  imageId,
  displayName,
  className = 'h-16 w-16',
}: {
  imageId: string | null;
  displayName: string;
  className?: string;
}) {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'MC';

  return (
    <GarmentPhoto
      imageId={imageId}
      alt={`Foto de perfil de ${displayName}`}
      rounded="rounded-full"
      className={`${className} shrink-0 object-cover bg-primary-soft text-primary`}
      fallback={<span className="font-heading text-lg font-bold" aria-hidden>{initials}</span>}
    />
  );
}
