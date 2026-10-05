import Link from 'next/link';

export function LegalLinks() {
  return (
    <nav aria-label="Información pública" className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-text-secondary">
      <Link prefetch={false} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/about">Sobre My Closet</Link>
      <Link prefetch={false} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/privacy">Privacidad</Link>
      <Link prefetch={false} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/terms">Términos</Link>
    </nav>
  );
}
