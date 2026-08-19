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
import type { CalendarEntry, Garment, Outfit } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import { CalendarIcon, HangerIcon, SparklesIcon } from '@/components/icons';

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
      garments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      outfits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

  const recentGarments = ((data?.garments ?? []) as Garment[]).filter(g => !g.deletedAt).slice(0, 4);

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3.5">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-[#8F5B66] text-lg font-bold text-white shadow-sm">
            {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : 'J'}
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-text-primary" data-testid="home-greeting">
            Hola, {profile.displayName.split(' ')[0]}
          </h1>
        </div>
      </div>

      <section className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-text-primary mb-0.5">
            Tu estilo de hoy
          </h2>
          <p className="text-[14px] text-text-secondary">Inspiración seleccionada para ti.</p>
        </div>
        <Link href="/wardrobe" className="text-sm font-semibold text-[#8F5B66] hover:text-[#7A4D57]">
          Ver todo
        </Link>
      </section>

      <section className="bg-surface-alt rounded-[1.8rem] p-6 md:p-8 relative shadow-sm border border-border/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-xs shrink-0">
            <p className="text-[11px] font-bold tracking-[0.15em] text-[#8F5B66] uppercase mb-2">
              Conjunto del día
            </p>
            <h3 className="font-heading text-3xl md:text-4xl text-text-primary font-bold leading-tight mb-3">
              Capas para cada día
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Una combinación cómoda para acompañarte todo el día.
            </p>
            <Link
              href="/outfits/new"
              className="inline-flex h-11 items-center rounded-xl bg-[#8F5B66] px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#7A4D57]"
            >
              Crear un conjunto
            </Link>
          </div>

          <div className="flex flex-col items-center gap-4 overflow-hidden">
            <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1 px-1">
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-jacket.jpg" alt="Chaqueta" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-sweatshirt.jpg" alt="Sudadera" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-jeans.jpg" alt="Vaqueros" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-bag.jpg" alt="Bolso" className="w-full h-full object-cover rounded-xl" />
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#8F5B66]"></div>
              <div className="w-2 h-2 rounded-full bg-border"></div>
              <div className="w-2 h-2 rounded-full bg-border"></div>
            </div>
          </div>
        </div>

      </section>

      <section className="grid grid-cols-3 gap-3">
        <StatCard href="/wardrobe" icon={<HangerIcon size={24} />} value={stats.totalGarments} label="Prendas" subtitle="Armario" testId="stat-garments" />
        <StatCard href="/outfits" icon={<SparklesIcon size={24} />} value={stats.totalOutfits} label="Conjuntos" subtitle="Estilos" testId="stat-outfits" />
        <StatCard href="/calendar" icon={<CalendarIcon size={24} />} value={stats.wornCount} label="Esta semana" subtitle="Planificados" testId="stat-worn" />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between mt-2">
          <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">Prendas recientes</h2>
          <Link href="/wardrobe" className="text-sm font-medium text-[#8F5B66] hover:text-[#7A4D57]">
            Ver todo
          </Link>
        </div>

        {recentGarments.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {recentGarments.map(garment => (
              <Link href={`/wardrobe/${garment.id}`} key={garment.id} className="card-surface p-3 transition-shadow hover:shadow-card flex flex-col rounded-2xl">
                <div className="aspect-[4/5] bg-[#F3EFEA] rounded-xl mb-3 relative overflow-hidden flex items-center justify-center">
                  <GarmentPhoto imageId={garment.photoId} alt={garment.name ?? ''} className="w-full h-full object-cover" iconSize={24} />
                </div>
                <h3 className="font-medium text-[13px] text-text-primary truncate">{garment.name}</h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Añadida el {new Date(garment.createdAt).toLocaleDateString('es-ES')}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 card-surface border-dashed rounded-2xl">
            <p className="text-sm text-text-secondary">Aún no hay prendas</p>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  href,
  icon,
  value,
  label,
  subtitle,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  value: number;
  label: string;
  subtitle: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="card-surface flex flex-col items-center justify-center gap-1.5 p-4 transition-shadow hover:shadow-card"
    >
      <div className="text-primary-hover mb-1">{icon}</div>
      <div className="text-center">
        <div className="text-[10px] text-text-secondary font-medium uppercase tracking-wider">{subtitle}</div>
        <div className="font-semibold text-2xl text-text-primary leading-tight">{value}</div>
        <div className="text-[11px] font-medium text-text-muted mt-0.5">{label}</div>
      </div>
    </Link>
  );
}
