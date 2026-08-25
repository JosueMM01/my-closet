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
import { CalendarIcon, HangerIcon, PlusIcon, UserIcon, HomeIcon } from '@/components/icons';
import { SyncBadge } from '@/components/ui';
import { OfflineRouteCache } from '@/components/offline-route-cache';

const DOCK_ITEMS = [
  { href: '/', label: 'Inicio', icon: HomeIcon, testId: 'nav-home' },
  { href: '/wardrobe', label: 'Armario', icon: HangerIcon, testId: 'nav-wardrobe' },
  { href: '/wardrobe/new', label: 'Añadir', icon: PlusIcon, isCreate: true, testId: 'nav-create' },
  { href: '/calendar', label: 'Calendario', icon: CalendarIcon, testId: 'nav-calendar' },
  { href: '/profile', label: 'Perfil', icon: UserIcon, testId: 'nav-profile' },
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
    <div className="min-h-dvh pb-28">
      <OfflineRouteCache userId={profile.userId} />
      {/* Top Header with Brand */}
      <header className="safe-top sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/30">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="font-heading text-2xl font-bold tracking-tight text-primary">
            My Closet
          </Link>
          <SyncBadge />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</main>

      {/* Dock inferior universal (tanto en web escritorio como en móvil) */}
      <nav
        aria-label="Principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface/95 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] backdrop-blur"
      >
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between px-4 sm:px-12 md:px-20">
          {DOCK_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            
            if ('isCreate' in item && item.isCreate) {
              return (
                <div key={item.href} className="flex h-full items-center justify-center">
                  <Link
                    href={item.href}
                    data-testid={item.testId}
                    className="flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105 active:scale-95"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-soft transition-colors hover:bg-primary-hover">
                      <item.icon size={22} />
                    </div>
                    <span className="text-[11px] font-medium text-text-muted">{item.label}</span>
                  </Link>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors py-2 px-3',
                  active ? 'text-primary' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                <item.icon size={22} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
