'use client';

/**
 * Muestra la foto de una prenda: blob local (IndexedDB) → URL remota →
 * placeholder editorial. Cache de object URLs por sesión.
 */
import { useEffect, useState } from 'react';
import { resolveImageUrl } from '@/lib/images/image-client';
import { ShirtIcon } from './icons';

export function useImageUrl(imageId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveImageUrl(imageId).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  return url;
}

export function GarmentPhoto({
  imageId,
  alt,
  className = '',
  rounded = 'rounded-xl',
  iconSize = 28,
}: {
  imageId: string | null;
  alt: string;
  className?: string;
  rounded?: string;
  iconSize?: number;
}) {
  const url = useImageUrl(imageId);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-alt text-text-muted ${rounded} ${className}`}
        aria-label={`${alt} (sin foto)`}
        role="img"
      >
        <ShirtIcon size={iconSize} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- blobs locales object-url
  return <img src={url} alt={alt} className={`${rounded} ${className}`} loading="lazy" />;
}
