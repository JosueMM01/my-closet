'use client';

/**
 * Home: saludo, resumen del armario, acción rápida de añadir y
 * próximos outfits programados.
 */
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { wardrobeStats } from '@/lib/local/queries';
import { today, weekDays } from '@/lib/domain/dates';
import type { CalendarEntry, Garment, Outfit } from '@/lib/domain/types';
import { CATEGORY_LABELS } from '@/lib/domain/constants';
import { GarmentPhoto } from '@/components/garment-photo';
import { CalendarIcon, HangerIcon, PlusIcon, SparklesIcon } from '@/components/icons';
import { Button } from '@/components/ui';

export default function HomePage() {
  const { profile } = useSession();

  const data = useLiveQuery(
    async () => {
      if (!profile) return null;
      const db = getDB();
      const [garments, outfits, entries] = await Promise.all([
        db.garments.where('userId').equals(profile.userId).toArray(),
        db.outfits.where('userId').equals(profile.userId).toArray(),
        db.calendarEntries.where('userId').equals(profile.userId).toArray(),
      ]);
      return { garments, outfits, entries };
    },
    [profile?.userId],
  );

  if (!profile) return null;

  const stats = wardrobeStats(
    (data?.garments ?? []) as Garment[],
    (data?.outfits ?? []) as Outfit[],
    (data?.entries ?? []) as CalendarEntry[],
  );

  // Próximos outfits: entradas de esta semana sin vestir.
  const days = weekDays(new Date());
  const upcoming = days
    .flatMap((day) => {
      const dateOnly = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return ((data?.entries ?? []) as CalendarEntry[])
        .filter((e) => !e.deletedAt && e.date === dateOnly)
        .map((entry) => ({ entry, outfit: ((data?.outfits ?? []) as Outfit[]).find((o) => o.id === entry.outfitId && !o.deletedAt) }));
    })
    .filter((item) => item.outfit)
    .slice(0, 3);

  const firstName = profile.displayName.split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-heading text-3xl" data-testid="home-greeting">
          Hola, {firstName} 👋
        </h1>
        <p className="mt-1 text-text-secondary">¿Qué te pondrás hoy?</p>
      </section>

      {stats.totalGarments === 0 ? (
        <section className="card-surface flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary">
            <HangerIcon size={30} />
          </div>
          <div>
            <h2 className="font-heading text-xl">¡Añade tu primera prenda!</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Fotografía tu ropa y organízala en un abrir y cerrar de ojos.
            </p>
          </div>
          <Link href="/wardrobe/new">
            <Button size="lg" data-testid="home-add-garment">
              <PlusIcon size={18} />
              Añadir prenda
            </Button>
          </Link>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-3">
            <StatCard href="/wardrobe" icon={<HangerIcon size={20} />} value={stats.totalGarments} label="Prendas" testId="stat-garments" />
            <StatCard href="/outfits" icon={<SparklesIcon size={20} />} value={stats.totalOutfits} label="Outfits" testId="stat-outfits" />
            <StatCard href="/calendar" icon={<CalendarIcon size={20} />} value={stats.wornCount} label="Vestidos" testId="stat-worn" />
          </section>

          {stats.topCategory && (
            <p className="px-1 text-sm text-text-secondary">
              Tu categoría con más prendas:{' '}
              <span className="font-semibold text-text-primary">
                {CATEGORY_LABELS[stats.topCategory.category] ?? stats.topCategory.category}
              </span>{' '}
              ({stats.topCategory.count})
            </p>
          )}

          {upcoming.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg">Esta semana</h2>
                <Link href="/calendar" className="text-sm font-semibold text-primary hover:text-primary-hover">
                  Ver calendario
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {upcoming.map(({ entry, outfit }) => {
                  const garments = ((data?.garments ?? []) as Garment[]).filter((g) =>
                    outfit!.slots.some((slot) => slot.garmentId === g.id),
                  );
                  return (
                    <Link
                      key={entry.id}
                      href={`/outfits/${outfit!.id}`}
                      className="card-surface flex items-center gap-3 p-3 transition-shadow hover:shadow-card"
                    >
                      <div className="flex -space-x-3">
                        {garments.slice(0, 3).map((garment) => (
                          <GarmentPhoto
                            key={garment.id}
                            imageId={garment.photoId}
                            alt={garment.name ?? ''}
                            className="h-12 w-12 border-2 border-surface object-cover"
                            iconSize={16}
                          />
                        ))}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {outfit!.name ?? 'Outfit'}
                        </p>
                        <p className="text-xs text-text-muted">{entry.date === today() ? 'Hoy' : entry.date}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card-surface flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-semibold">Añadir prenda nueva</p>
              <p className="text-xs text-text-secondary">Se guarda al instante, incluso sin conexión</p>
            </div>
            <Link href="/wardrobe/new">
              <Button data-testid="home-add-garment">
                <PlusIcon size={18} />
                Añadir
              </Button>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  href,
  icon,
  value,
  label,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  value: number;
  label: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="card-surface flex flex-col items-center gap-1 p-4 transition-shadow hover:shadow-card"
    >
      <span className="text-primary">{icon}</span>
      <span className="font-heading text-2xl">{value}</span>
      <span className="text-xs font-medium text-text-secondary">{label}</span>
    </Link>
  );
}
