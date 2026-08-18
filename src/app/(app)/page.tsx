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
import { CalendarIcon, HangerIcon, PlusIcon, SparklesIcon, BellIcon } from '@/components/icons';
import { Button } from '@/components/ui';

export default function HomePage() {
  const { profile } = useSession();

  const data = useLiveQuery(
    async () => {
      if (!profile) return null;
      const db = getDB();
      const [garments, outfits, entries] = await Promise.all([
        db.garments.orderBy('updatedAt').reverse().toArray(),
        db.outfits.orderBy('updatedAt').reverse().toArray(),
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

  const recentGarments = ((data?.garments ?? []) as Garment[]).filter(g => !g.deletedAt).slice(0, 4);

  return (
    <div className="space-y-7">
      {/* Profile Header Row */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3.5">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-[#8F5B66] text-lg font-bold text-white shadow-sm">
            {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : 'J'}
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-text-primary" data-testid="home-greeting">
            Hi, {profile.displayName.split(' ')[0]}
          </h1>
        </div>
        <button className="relative flex h-10 w-10 items-center justify-center text-text-primary hover:text-primary transition-colors" aria-label="Notificaciones">
          <BellIcon size={24} />
          <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"></span>
        </button>
      </div>

      {/* Your style today heading */}
      <section className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-text-primary mb-0.5">
            Your style today
          </h2>
          <p className="text-[14px] text-text-secondary">Curated inspiration, just for you.</p>
        </div>
        <Link href="/wardrobe" className="text-sm font-semibold text-[#8F5B66] hover:text-[#7A4D57]">
          See all
        </Link>
      </section>

      {/* Outfit of the day mockup matching closet1.png */}
      <section className="bg-surface-alt rounded-[1.8rem] p-6 md:p-8 relative shadow-sm border border-border/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Left Text and CTA */}
          <div className="max-w-xs shrink-0">
            <p className="text-[11px] font-bold tracking-[0.15em] text-[#8F5B66] uppercase mb-2">
              Outfit of the day
            </p>
            <h3 className="font-heading text-3xl md:text-4xl text-text-primary font-bold leading-tight mb-3">
              Everyday Layers
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Effortless layers for a busy day.
            </p>
            <Button className="font-medium bg-[#8F5B66] hover:bg-[#7A4D57] text-white rounded-[12px] px-6 py-2.5 shadow-sm">
              Wear This Look
            </Button>
          </div>

          {/* Right Image Grid / Carousel */}
          <div className="flex flex-col items-center gap-4 overflow-hidden">
            <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1 px-1">
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-jacket.jpg" alt="Jacket" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-sweatshirt.jpg" alt="Sweatshirt" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-jeans.jpg" alt="Jeans" className="w-full h-full object-cover rounded-xl" />
              </div>
              <div className="h-40 w-32 md:h-48 md:w-36 rounded-2xl overflow-hidden bg-surface shadow-sm border border-border/60 shrink-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/item-bag.jpg" alt="Bag" className="w-full h-full object-cover rounded-xl" />
              </div>
            </div>

            {/* Carousel Dots */}
            <div className="flex justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#8F5B66]"></div>
              <div className="w-2 h-2 rounded-full bg-border"></div>
              <div className="w-2 h-2 rounded-full bg-border"></div>
            </div>
          </div>
        </div>

        {/* Heart Icon Top Right */}
        <button 
          className="absolute top-5 right-5 text-text-primary hover:text-primary transition-colors p-1"
          aria-label="Guardar outfit"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20s-7.5-4.7-9.3-9.6C1.4 7 3.6 4 6.9 4c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.3 0 5.5 3 4.2 6.4C19.5 15.3 12 20 12 20Z"/>
          </svg>
        </button>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <StatCard href="/wardrobe" icon={<HangerIcon size={24} />} value={stats.totalGarments} label="Items" subtitle="Closet" testId="stat-garments" />
        <StatCard href="/outfits" icon={<SparklesIcon size={24} />} value={stats.totalOutfits} label="Outfits" subtitle="Looks" testId="stat-outfits" />
        <StatCard href="/calendar" icon={<CalendarIcon size={24} />} value={stats.wornCount} label="This week" subtitle="Planned" testId="stat-worn" />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between mt-2">
          <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">Recent</h2>
          <Link href="/wardrobe" className="text-sm font-medium text-[#8F5B66] hover:text-[#7A4D57]">
            See all
          </Link>
        </div>
        
        <div className="flex bg-surface-alt rounded-full p-1 mb-5 w-max">
          <button className="px-5 py-1.5 rounded-full bg-surface shadow-sm text-[13px] font-semibold text-text-primary">Recent Items</button>
          <button className="px-5 py-1.5 rounded-full text-[13px] font-medium text-text-secondary">Recent Outfits</button>
        </div>

        {recentGarments.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {recentGarments.map(garment => (
              <div key={garment.id} className="card-surface p-3 transition-shadow hover:shadow-card flex flex-col rounded-2xl">
                <div className="aspect-[4/5] bg-[#F3EFEA] rounded-xl mb-3 relative overflow-hidden flex items-center justify-center">
                  <GarmentPhoto imageId={garment.photoId} alt={garment.name ?? ''} className="w-full h-full object-cover" iconSize={24} />
                  <button className="absolute top-2.5 right-2.5 text-text-primary hover:text-[#8F5B66] transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                  </button>
                </div>
                <h3 className="font-medium text-[13px] text-text-primary truncate">{garment.name}</h3>
                <p className="text-[11px] text-text-muted mt-0.5">Added 2d ago</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 card-surface border-dashed rounded-2xl">
            <p className="text-sm text-text-secondary">No items yet</p>
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
