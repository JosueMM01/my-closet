'use client';

/**
 * Shell de la aplicación: header con perfil y estado de sync,
 * dock inferior de navegación y FAB de añadir.
 * Mobile-first; en desktop el dock se convierte en barra superior.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { useSession } from '@/components/providers';
import { CalendarIcon, HangerIcon, PlusIcon, SparklesIcon } from '@/components/icons';
import { SyncBadge } from '@/components/ui';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

const DOCK_ITEMS = [
  { href: '/wardrobe', label: 'Armario', icon: HangerIcon, testId: 'nav-wardrobe' },
  { href: '/outfits', label: 'Outfits', icon: SparklesIcon, testId: 'nav-outfits' },
  { href: '/calendar', label: 'Calendario', icon: CalendarIcon, testId: 'nav-calendar' },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !profile) router.replace('/login');
  }, [loading, profile, router]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          role="status"
          aria-label="Cargando"
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-24 md:pb-8">
      <header className="safe-top sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link
            href="/profile"
            className="flex min-w-0 items-center gap-3"
            aria-label="Ver perfil"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">
              {initials(profile.displayName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-text-primary">
                {profile.displayName}
              </span>
              <span className="block truncate text-xs text-text-muted">{profile.email}</span>
            </span>
          </Link>
          <SyncBadge />
        </div>

        {/* Dock horizontal en desktop */}
        <nav className="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 md:flex" aria-label="Principal">
          {DOCK_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-primary-soft text-primary'
                    : 'text-text-secondary hover:bg-surface-alt',
                )}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-5 md:py-8">{children}</main>

      {/* FAB */}
      <Link
        href="/wardrobe/new"
        data-testid="fab-add-garment"
        aria-label="Añadir prenda"
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-card transition-colors hover:bg-primary-hover md:bottom-8 md:right-8"
      >
        <PlusIcon size={26} />
      </Link>

      {/* Dock inferior móvil */}
      <nav
        aria-label="Principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-surface/95 shadow-dock backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-3">
          {DOCK_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                  active ? 'text-primary' : 'text-text-muted',
                )}
              >
                <item.icon size={24} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
