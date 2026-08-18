'use client';

/**
 * Calendario: vista semanal (lun–dom) con chips de outfits por día,
 * mini-mes navegable, marcar "vestido" y entradas del historial.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { deleteCalendarEntry, updateCalendarEntry } from '@/lib/local/repositories';
import {
  addDays,
  dayLabel,
  longDateLabel,
  monthYearLabel,
  parseDateOnly,
  startOfWeek,
  toDateOnly,
  today,
  weekDays,
} from '@/lib/domain/dates';
import type { CalendarEntry, Garment, Outfit } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons';
import { Button, EmptyState } from '@/components/ui';

export default function CalendarPage() {
  const router = useRouter();
  const { profile } = useSession();
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [entryToDelete, setEntryToDelete] = useState<CalendarEntry | null>(null);

  const data = useLiveQuery(
    async () => {
      if (!profile) return null;
      const db = getDB();
      const [entries, outfits, garments] = await Promise.all([
        db.calendarEntries.where('userId').equals(profile.userId).toArray(),
        db.outfits.where('userId').equals(profile.userId).toArray(),
        db.garments.where('userId').equals(profile.userId).toArray(),
      ]);
      return { entries, outfits, garments };
    },
    [profile?.userId],
  );

  const entries = ((data?.entries ?? []) as CalendarEntry[]).filter((e) => !e.deletedAt);
  const outfits = ((data?.outfits ?? []) as Outfit[]).filter((o) => !o.deletedAt);
  const garments = (data?.garments ?? []) as Garment[];

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) ?? [];
      list.push(entry);
      map.set(entry.date, list);
    }
    return map;
  }, [entries]);

  if (!profile) return null;

  const monthMatrixFull = buildFullMonthMatrix(monthAnchor);
  
  // Upcoming looks logic
  const selectedDateObj = parseDateOnly(selectedDate);
  const upcomingEntries = entries
    .filter(e => {
      const d = parseDateOnly(e.date);
      return d.getTime() >= selectedDateObj.getTime();
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary">Calendar</h1>
      </div>

      {/* Mes navegable */}
      <section>
        <div className="mb-4 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => setMonthAnchor((d) => addDays(d, -30))}
            aria-label="Mes anterior"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:bg-surface-alt transition-colors"
          >
            <ChevronLeftIcon size={20} />
          </button>
          <p className="text-lg font-semibold tracking-wide text-text-primary">
            {monthYearLabel(monthAnchor)}
          </p>
          <button
            type="button"
            onClick={() => setMonthAnchor((d) => addDays(d, 30))}
            aria-label="Mes siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:bg-surface-alt transition-colors"
          >
            <ChevronRightIcon size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1.5 md:gap-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => (
            <div key={i} className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
              {label}
            </div>
          ))}
          
          {monthMatrixFull.map((cell, idx) => {
            if (!cell.dateOnly) {
              return <div key={`empty-${idx}`} className="aspect-square rounded-2xl" />;
            }
            
            const dateOnly = cell.dateOnly;
            const dayEntries = entriesByDate.get(dateOnly) ?? [];
            const isToday = dateOnly === today();
            const isSelected = dateOnly === selectedDate;
            
            let coverPhotoId = null;
            if (dayEntries.length > 0) {
              const outfit = outfits.find(o => o.id === dayEntries[0]!.outfitId);
              if (outfit && outfit.slots.length > 0) {
                const g = garments.find(g => g.id === outfit.slots[0]!.garmentId);
                if (g) coverPhotoId = g.photoId;
              }
            }

            return (
              <button
                key={dateOnly}
                type="button"
                onClick={() => setSelectedDate(dateOnly)}
                aria-pressed={isSelected}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl border transition-all overflow-hidden ${
                  isSelected
                    ? 'border-primary bg-primary-soft ring-2 ring-primary/20 scale-105 z-10 shadow-soft'
                    : 'border-border/50 bg-surface hover:border-border hover:bg-surface-alt'
                }`}
              >
                <span
                  className={`absolute top-1.5 left-2 text-[11px] font-semibold ${
                    isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white -ml-1 -mt-0.5' : isSelected ? 'text-primary' : 'text-text-primary'
                  }`}
                >
                  {cell.day}
                </span>
                
                {coverPhotoId && (
                  <div className="absolute inset-0 top-4 pt-1 px-1.5 pb-0.5 pointer-events-none">
                    <GarmentPhoto
                      imageId={coverPhotoId}
                      alt="Outfit"
                      className="w-full h-full object-contain"
                      iconSize={16}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Upcoming looks */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-text-primary">Upcoming looks</h2>
          <Link
            href={`/outfits/new?date=${selectedDate}`}
            className="flex items-center justify-center h-10 w-10 rounded-full bg-primary text-white hover:bg-primary-hover shadow-soft transition-colors"
          >
            <PlusIcon size={20} />
          </Link>
        </div>

        {upcomingEntries.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={32} />}
            title="No upcoming looks"
            description="Plan an outfit for the selected day."
          />
        ) : (
          <div className="space-y-4">
            {upcomingEntries.slice(0, 5).map((entry) => {
              const outfit = outfits.find((o) => o.id === entry.outfitId);
              if (!outfit) return null;
              
              const slotGarments = outfit.slots
                .map((slot) => garments.find((g) => g.id === slot.garmentId && !g.deletedAt))
                .filter((g): g is Garment => Boolean(g));
                
              const d = parseDateOnly(entry.date);
              const dayStr = dayLabel(d).substring(0, 3).toUpperCase();
              
              return (
                <div key={entry.id} className="card-surface p-4 flex gap-4 transition-shadow hover:shadow-card group">
                  <div className="flex flex-col items-center justify-center shrink-0 w-12 pt-2 border-r border-border pr-4">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{dayStr}</span>
                    <span className="text-2xl font-semibold text-text-primary">{d.getDate()}</span>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => router.push(`/outfits/${outfit.id}`)}
                    className="flex-1 flex gap-3 items-center text-left min-w-0"
                  >
                    <div className="flex -space-x-3 shrink-0">
                      {slotGarments.slice(0, 3).map((garment) => (
                        <GarmentPhoto
                          key={garment.id}
                          imageId={garment.photoId}
                          alt={garment.name ?? ''}
                          className="h-16 w-16 rounded-xl border-2 border-surface object-cover bg-surface-alt"
                          iconSize={18}
                        />
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-text-primary">{outfit.name ?? 'Untitled Outfit'}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {slotGarments.length} {slotGarments.length === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                  </button>
                  
                  <div className="flex flex-col justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setEntryToDelete(entry)}
                      className="p-2 rounded-full text-danger hover:bg-danger/10"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={entryToDelete !== null}
        title="Remove from calendar?"
        message="The outfit will no longer be scheduled for this day, but it will not be deleted."
        confirmLabel="Remove"
        onConfirm={() => entryToDelete && void deleteCalendarEntry(entryToDelete.id)}
        onClose={() => setEntryToDelete(null)}
      />
    </div>
  );
}

function buildFullMonthMatrix(anchor: Date): { dateOnly: string | null; day: number | null }[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  
  const firstDayOfWeek = (first.getDay() === 0 ? 7 : first.getDay()) - 1; // 0 for Monday
  
  const cells = [];
  
  // Pad beginning
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ dateOnly: null, day: null });
  }
  
  // Fill days
  for (let i = 1; i <= last.getDate(); i++) {
    const d = new Date(year, month, i);
    cells.push({ dateOnly: toDateOnly(d), day: i });
  }
  
  // Pad end to complete weeks
  const remainder = cells.length % 7;
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      cells.push({ dateOnly: null, day: null });
    }
  }
  
  return cells;
}
