'use client';

import { useParams, useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { GarmentForm } from '@/components/garment-form';
import { XIcon } from '@/components/icons';

export default function EditGarmentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { profile } = useSession();

  const garment = useLiveQuery(
    async () => (params?.id ? getDB().garments.get(params.id) : undefined),
    [params?.id],
  );

  if (!profile) return null;
  if (garment === undefined) {
    return <div className="card-surface mx-auto h-96 max-w-xl animate-pulse" aria-label="Cargando" />;
  }
  if (!garment || garment.deletedAt) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <p className="text-text-secondary">Esta prenda ya no existe.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Editar prenda</h1>
        <button
          type="button"
          onClick={() => router.push(`/wardrobe/${garment.id}`)}
          aria-label="Cancelar"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <XIcon size={20} />
        </button>
      </div>
      <GarmentForm userId={profile.userId} garment={garment} />
    </div>
  );
}
