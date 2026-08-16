'use client';

import { useRouter } from 'next/navigation';
import { useSession } from '@/components/providers';
import { GarmentForm } from '@/components/garment-form';
import { XIcon } from '@/components/icons';

export default function NewGarmentPage() {
  const router = useRouter();
  const { profile } = useSession();
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Añadir prenda</h1>
        <button
          type="button"
          onClick={() => router.push('/wardrobe')}
          aria-label="Cancelar"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <XIcon size={20} />
        </button>
      </div>
      <GarmentForm userId={profile.userId} />
    </div>
  );
}
