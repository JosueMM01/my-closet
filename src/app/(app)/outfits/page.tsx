'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import type { Garment, Outfit } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import { PlusIcon, SparklesIcon } from '@/components/icons';
import { Button, EmptyState } from '@/components/ui';

export default function OutfitsPage() {
  const { profile } = useSession();

  const data = useLiveQuery(
    async () => {
      if (!profile) return null;
      const db = getDB();
      const [outfits, garments] = await Promise.all([
        db.outfits.where('userId').equals(profile.userId).toArray(),
        db.garments.where('userId').equals(profile.userId).toArray(),
      ]);
      return { outfits, garments };
    },
    [profile?.userId],
  );

  if (!profile) return null;

  const outfits = ((data?.outfits ?? []) as Outfit[]).filter((o) => !o.deletedAt);
  const garments = (data?.garments ?? []) as Garment[];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Conjuntos</h1>
        <Link href="/outfits/new">
          <Button data-testid="new-outfit">
            <PlusIcon size={18} />
            Nuevo
          </Button>
        </Link>
      </div>

      {data === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-surface h-40 animate-pulse" />
          ))}
        </div>
      ) : outfits.length === 0 ? (
        <EmptyState
          icon={<SparklesIcon size={28} />}
          title="Aún no hay conjuntos"
          description="Combina tus prendas y reutiliza tus combinaciones cuando quieras."
          action={
            <Link href="/outfits/new">
              <Button data-testid="empty-new-outfit">Crear conjunto</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="outfits-list">
          {outfits.map((outfit) => {
            const slotGarments = outfit.slots
              .map((slot) => garments.find((g) => g.id === slot.garmentId && !g.deletedAt))
              .filter((g): g is Garment => Boolean(g));
            return (
              <Link
                key={outfit.id}
                href={`/outfits/${outfit.id}`}
                data-testid="outfit-card"
                className="card-surface flex items-center gap-4 p-4 transition-shadow hover:shadow-card"
              >
                <div className="flex -space-x-4">
                  {slotGarments.slice(0, 4).map((garment) => (
                    <GarmentPhoto
                      key={garment.id}
                      imageId={garment.photoId}
                      alt={garment.name ?? ''}
                      className="h-16 w-16 border-2 border-surface object-cover"
                      iconSize={20}
                    />
                  ))}
                  {slotGarments.length === 0 && (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-alt text-text-muted">
                      <SparklesIcon size={22} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{outfit.name ?? 'Conjunto sin nombre'}</p>
                  <p className="text-xs text-text-secondary">
                    {outfit.slots.length} {outfit.slots.length === 1 ? 'prenda' : 'prendas'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
