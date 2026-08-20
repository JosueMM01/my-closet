'use client';

/**
 * Muestra la foto de una prenda: blob local (IndexedDB) → URL remota →
 * placeholder editorial. Reacciona a metadatos que lleguen por sync.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '@/lib/local/db';
import { ShirtIcon } from './icons';

export function useImageUrl(imageId: string | null): string | null {
  const image = useLiveQuery(
    async () => (imageId ? getDB().images.get(imageId) : undefined),
    [imageId],
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const blob = image?.blob;
    const nextUrl = blob && blob.size > 0 ? URL.createObjectURL(blob) : null;
    queueMicrotask(() => {
      if (active) setObjectUrl(nextUrl);
      else if (nextUrl) URL.revokeObjectURL(nextUrl);
    });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [image?.blob]);

  return objectUrl ?? image?.remoteUrl ?? null;
}

export function GarmentPhoto({
  imageId,
  alt,
  className = '',
  rounded = 'rounded-xl',
  iconSize = 28,
  fallback,
}: {
  imageId: string | null;
  alt: string;
  className?: string;
  rounded?: string;
  iconSize?: number;
  fallback?: ReactNode;
}) {
  const url = useImageUrl(imageId);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-alt text-text-muted ${rounded} ${className}`}
        aria-label={`${alt} (sin foto)`}
        role="img"
      >
        {fallback ?? <ShirtIcon size={iconSize} />}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- blobs locales object-url
  return <img src={url} alt={alt} className={`${rounded} ${className}`} loading="lazy" />;
}
