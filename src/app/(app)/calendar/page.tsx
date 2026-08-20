'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { deleteCalendarEntry, updateCalendarEntry } from '@/lib/local/repositories';
import {
  longDateLabel,
  monthYearLabel,
  parseDateOnly,
  toDateOnly,
  today,
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
import { EmptyState } from '@/components/ui';

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export default function CalendarPage() {
  const router = useRouter();
  const { profile } = useSession();
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthAnchor, setMonthAnchor] = useState(() => parseDateOnly(today()));
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

  const entries = ((data?.entries ?? []) as CalendarEntry[]).filter((entry) => !entry.deletedAt);
  const outfits = ((data?.outfits ?? []) as Outfit[]).filter((outfit) => !outfit.deletedAt);
  const garments = (data?.garments ?? []) as Garment[];

  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const current = grouped.get(entry.date) ?? [];
      current.push(entry);
      grouped.set(entry.date, current);
    }
    return grouped;
  }, [entries]);

  if (!profile) return null;

  const monthCells = buildMonthMatrix(monthAnchor);
  const selectedEntries = entriesByDate.get(selectedDate) ?? [];

  function moveMonth(offset: -1 | 1) {
    const nextMonth = new Date(
      monthAnchor.getFullYear(),
      monthAnchor.getMonth() + offset,
      1,
    );
    setMonthAnchor(nextMonth);
    setSelectedDate(toDateOnly(nextMonth));
  }

  async function toggleWorn(entry: CalendarEntry) {
    await updateCalendarEntry(entry.id, {
      wornAt: entry.wornAt ? null : new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-7">
      <h1 className="text-3xl font-semibold tracking-tight text-text-primary">Calendario</h1>

      <section aria-labelledby="calendar-month-title">
        <div className="mb-4 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            aria-label="Mes anterior"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-alt"
          >
            <ChevronLeftIcon size={20} />
          </button>
          <h2 id="calendar-month-title" className="text-lg font-semibold text-text-primary">
            {monthYearLabel(monthAnchor)}
          </h2>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            aria-label="Mes siguiente"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-alt"
          >
            <ChevronRightIcon size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1.5 md:gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-text-muted"
            >
              {label}
            </div>
          ))}

          {monthCells.map((cell, index) => {
            if (!cell.dateOnly) {
              return <div key={`empty-${index}`} className="aspect-square" aria-hidden="true" />;
            }

            const dateOnly = cell.dateOnly;
            const dayEntries = entriesByDate.get(dateOnly) ?? [];
            const isToday = dateOnly === today();
            const isSelected = dateOnly === selectedDate;
            const firstOutfit = outfits.find((outfit) => outfit.id === dayEntries[0]?.outfitId);
            const firstGarment = garments.find(
              (garment) => garment.id === firstOutfit?.slots[0]?.garmentId,
            );
            const entryCountLabel =
              dayEntries.length === 0
                ? 'sin conjuntos'
                : `${dayEntries.length} ${dayEntries.length === 1 ? 'conjunto' : 'conjuntos'}`;

            return (
              <button
                key={dateOnly}
                type="button"
                onClick={() => setSelectedDate(dateOnly)}
                aria-label={`${longDateLabel(dateOnly)}, ${entryCountLabel}`}
                aria-pressed={isSelected}
                data-testid="calendar-day"
                data-date={dateOnly}
                className={`relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-2xl border transition-all ${
                  isSelected
                    ? 'z-10 scale-105 border-primary bg-primary-soft shadow-soft ring-2 ring-primary/20'
                    : 'border-border/50 bg-surface hover:border-border hover:bg-surface-alt'
                }`}
              >
                <span
                  className={`absolute left-2 top-1.5 text-[11px] font-semibold ${
                    isToday
                      ? '-ml-1 -mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white'
                      : isSelected
                        ? 'text-primary'
                        : 'text-text-primary'
                  }`}
                >
                  {cell.day}
                </span>

                {firstGarment?.photoId ? (
                  <div className="pointer-events-none absolute inset-0 top-4 px-1.5 pb-0.5 pt-1">
                    <GarmentPhoto
                      imageId={firstGarment.photoId}
                      alt=""
                      className="h-full w-full object-contain"
                      iconSize={16}
                    />
                  </div>
                ) : null}
                {dayEntries.length > 0 ? (
                  <span className="absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="selected-day-title">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 id="selected-day-title" className="text-xl font-semibold text-text-primary">
              Conjuntos del día
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">{longDateLabel(selectedDate)}</p>
          </div>
          <Link
            href={`/outfits/new?date=${selectedDate}`}
            aria-label={`Crear conjunto para ${longDateLabel(selectedDate)}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-soft transition-colors hover:bg-primary-hover"
          >
            <PlusIcon size={20} />
          </Link>
        </div>

        {selectedEntries.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={32} />}
            title="No hay conjuntos programados"
            description="Crea un conjunto para el día seleccionado."
          />
        ) : (
          <div className="space-y-3" data-testid="day-entries">
            {selectedEntries.map((entry) => {
              const outfit = outfits.find((candidate) => candidate.id === entry.outfitId);
              if (!outfit) return null;
              const slotGarments = outfit.slots
                .map((slot) => garments.find((garment) => garment.id === slot.garmentId && !garment.deletedAt))
                .filter((garment): garment is Garment => Boolean(garment));

              return (
                <article key={entry.id} className="card-surface p-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/outfits/${outfit.id}`)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-label={`Ver conjunto ${outfit.name ?? 'sin nombre'}`}
                    >
                      <div className="flex shrink-0 -space-x-3">
                        {slotGarments.slice(0, 3).map((garment) => (
                          <GarmentPhoto
                            key={garment.id}
                            imageId={garment.photoId}
                            alt={garment.name ?? ''}
                            className="h-14 w-14 border-2 border-surface bg-surface-alt object-cover"
                            iconSize={18}
                          />
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {outfit.name ?? 'Conjunto sin nombre'}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary">
                          {slotGarments.length} {slotGarments.length === 1 ? 'prenda' : 'prendas'}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleWorn(entry)}
                      aria-label={entry.wornAt ? 'Marcar como no vestido' : 'Marcar como vestido'}
                      aria-pressed={Boolean(entry.wornAt)}
                      data-testid="toggle-worn"
                      className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                        entry.wornAt
                          ? 'bg-success/15 text-success'
                          : 'bg-surface-alt text-text-secondary hover:text-primary'
                      }`}
                    >
                      <CheckIcon size={15} />
                      {entry.wornAt ? 'Vestido' : 'Marcar vestido'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryToDelete(entry)}
                      aria-label="Quitar del calendario"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger/10"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={entryToDelete !== null}
        title="¿Quitar del calendario?"
        message="El conjunto dejará de estar programado para este día, pero no se eliminará."
        confirmLabel="Quitar"
        onConfirm={() => entryToDelete && void deleteCalendarEntry(entryToDelete.id)}
        onClose={() => setEntryToDelete(null)}
      />
    </div>
  );
}

function buildMonthMatrix(anchor: Date): { dateOnly: string | null; day: number | null }[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const leadingCells = (firstDay.getDay() + 6) % 7;
  const cells: { dateOnly: string | null; day: number | null }[] = [];

  for (let index = 0; index < leadingCells; index += 1) {
    cells.push({ dateOnly: null, day: null });
  }
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    cells.push({ dateOnly: toDateOnly(new Date(year, month, day)), day });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ dateOnly: null, day: null });
  }

  return cells;
}
