import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getPublicGarment, getPublicOutfit } from '@/server/repositories/sync-repository';
import { CATEGORY_LABELS, COLOR_HEX, COLOR_LABELS } from '@/lib/domain/constants';
import { HangerIcon, SparklesIcon } from '@/components/icons';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ type: string; shareableId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { type, shareableId } = await params;
  if (type === 'garment') {
    const garment = await getPublicGarment(shareableId);
    return { title: garment?.name ?? 'Prenda compartida' };
  }
  if (type === 'outfit') {
    const outfit = await getPublicOutfit(shareableId);
    return { title: outfit?.name ?? 'Conjunto compartido' };
  }
  return { title: 'Compartido · My Closet' };
}

export default async function SharePage({ params }: PageProps) {
  const { type, shareableId } = await params;

  if (type === 'garment') {
    const garment = await getPublicGarment(shareableId);
    if (!garment) notFound();
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <ShareHeader icon={<HangerIcon size={22} />} title={garment.name ?? 'Prenda'} />
        <div className="card-surface mt-6 overflow-hidden">
          <div className="aspect-square w-full bg-surface-alt" />
          <div className="space-y-4 p-5">
            <p className="text-sm text-text-secondary">
              {CATEGORY_LABELS[garment.category] ?? garment.category}
              {garment.brand ? ` · ${garment.brand}` : ''}
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {garment.colors.length > 0 && (
                <div>
                  <dt className="text-xs uppercase text-text-muted">Colores</dt>
                  <dd className="mt-1 flex gap-1.5">
                    {garment.colors.map((color) => (
                      <span
                        key={color}
                        title={COLOR_LABELS[color] ?? color}
                        className="h-4 w-4 rounded-full border border-border"
                        style={{ background: COLOR_HEX[color] ?? '#A79F99' }}
                      />
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-text-muted">
          Compartido desde My Closet · La foto requiere sincronización del propietario
        </p>
      </main>
    );
  }

  if (type === 'outfit') {
    const outfit = await getPublicOutfit(shareableId);
    if (!outfit) notFound();
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <ShareHeader icon={<SparklesIcon size={22} />} title={outfit.name ?? 'Conjunto'} />
        <div className="card-surface mt-6 divide-y divide-border">
          {outfit.slots.map((slot, index) => (
            <div key={index} className="flex items-center gap-3 p-4">
              <div className="h-16 w-16 rounded-xl bg-surface-alt" />
              <p className="text-sm font-medium">
                {CATEGORY_LABELS[slot.category] ?? slot.category}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-text-muted">
          Compartido desde My Closet · Las fotos requieren sincronización del propietario
        </p>
      </main>
    );
  }

  notFound();
}

function ShareHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </div>
      <h1 className="font-heading text-2xl">{title}</h1>
      <p className="mt-1 text-sm text-text-secondary">Vista compartida</p>
    </div>
  );
}
