import Link from 'next/link';
import { HangerIcon } from '@/components/icons';

export const metadata = { title: 'Sin conexión' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-soft text-primary">
        <HangerIcon size={36} />
      </div>
      <h1 className="mt-6 font-heading text-2xl">Sin conexión</h1>
      <p className="mt-2 max-w-xs text-sm text-text-secondary">
        No te preocupes: tus prendas, conjuntos y calendario siguen disponibles.
        Vuelve a intentarlo cuando recuperes conexión.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-white"
      >
        Reintentar
      </Link>
    </main>
  );
}
