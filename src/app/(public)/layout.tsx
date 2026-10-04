import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { LegalLinks } from '@/components/legal-links';
import { LegalContact } from '@/components/legal-contact';
import { parseLegalContact } from '@/lib/legal-config';

export function generateMetadata(): Metadata {
  const { ready } = parseLegalContact({
    operatorName: process.env.PUBLIC_LEGAL_OPERATOR_NAME,
    contactEmail: process.env.PUBLIC_LEGAL_CONTACT_EMAIL,
  });
  return { robots: { index: ready, follow: true } };
}

/** Public documents deliberately do not mount IndexedDB, session, sync or model runtime. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#public-content" className="sr-only focus:not-sr-only focus:p-4">Ir al contenido</a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/about" prefetch={false} className="font-heading text-2xl font-bold text-primary">My Closet</Link>
          <Link href="/login" prefetch={false} className="inline-flex min-h-11 items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-primary-soft">Entrar</Link>
        </div>
      </header>
      <main id="public-content" className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        {children}
        <div className="mt-12"><LegalContact /></div>
      </main>
      <footer className="border-t border-border px-5 py-6"><LegalLinks /></footer>
    </div>
  );
}
