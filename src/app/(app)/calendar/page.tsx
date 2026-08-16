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
  const [weekOffset, setWeekOffset] = useState(0);
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

  const days = useMemo(() => weekDays(addDays(new Date(), weekOffset * 7)), [weekOffset]);
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

  const selectedEntries = entriesByDate.get(selectedDate) ?? [];
  const wornHistory = entries.filter((e) => e.wornAt).slice(-8).reverse();

  if (!profile) return null;

  const monthMatrix = buildMonthMatrix(monthAnchor);
  const datesWithEntries = new Set(entriesByDate.keys());

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl">Calendario</h1>
        <Link href="/outfits/new">
          <Button data-testid="new-from-calendar">
            <PlusIcon size={18} />
            Outfit
          </Button>
        </Link>
      </div>

      {/* Vista semanal */}
      <section className="card-surface p-4" data-testid="week-view">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Semana anterior"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <ChevronLeftIcon size={18} />
          </button>
          <p className="text-sm font-semibold">
            {weekOffset === 0
              ? 'Esta semana'
              : weekOffset === -1
                ? 'Semana pasada'
                : weekOffset === 1
                  ? 'Próxima semana'
                  : `${days[0]!.getDate()}–${days[6]!.getDate()}`}
          </p>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Semana siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const dateOnly = toDateOnly(day);
            const dayEntries = entriesByDate.get(dateOnly) ?? [];
            const isToday = dateOnly === today();
            const isSelected = dateOnly === selectedDate;
            return (
              <button
                key={dateOnly}
                type="button"
                onClick={() => setSelectedDate(dateOnly)}
                aria-pressed={isSelected}
                aria-label={`${longDateLabel(dateOnly)}, ${dayEntries.length} outfits`}
                data-testid="calendar-day"
                data-date={dateOnly}
                className={`flex min-h-[4.5rem] flex-col items-center gap-1 rounded-xl border p-1.5 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary-soft'
                    : 'border-border/60 bg-surface hover:bg-surface-alt'
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase ${isSelected ? 'text-primary' : 'text-text-muted'}`}>
                  {dayLabel(day)}
                </span>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                    isToday ? 'bg-primary text-white' : isSelected ? 'text-primary' : 'text-text-primary'
                  }`}
                >
                  {day.getDate()}
                </span>
                {dayEntries.length > 0 && (
                  <span className="flex gap-0.5">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <span
                        key={entry.id}
                        className={`h-1.5 w-1.5 rounded-full ${entry.wornAt ? 'bg-success' : 'bg-primary'}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Detalle del día */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg">{longDateLabel(selectedDate)}</h2>
          <Link
            href={`/outfits/new?date=${selectedDate}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
            data-testid="build-outfit-for-day"
          >
            <PlusIcon size={16} />
            Añadir outfit
          </Link>
        </div>
        {selectedEntries.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={28} />}
            title="Nada planeado"
            description="Programa un outfit para este día."
            action={
              <Link href={`/outfits/new?date=${selectedDate}`}>
                <Button>Crear outfit</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-3" data-testid="day-entries">
            {selectedEntries.map((entry) => {
              const outfit = outfits.find((o) => o.id === entry.outfitId);
              if (!outfit) return null;
              const slotGarments = outfit.slots
                .map((slot) => garments.find((g) => g.id === slot.garmentId && !g.deletedAt))
                .filter((g): g is Garment => Boolean(g));
              return (
                <div key={entry.id} className="card-surface flex items-center gap-3 p-3">
                  <div className="flex -space-x-3">
                    {slotGarments.slice(0, 4).map((garment) => (
                      <GarmentPhoto
                        key={garment.id}
                        imageId={garment.photoId}
                        alt={garment.name ?? ''}
                        className="h-14 w-14 border-2 border-surface object-cover"
                        iconSize={18}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/outfits/${outfit.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-semibold">{outfit.name ?? 'Outfit'}</p>
                    <p className="text-xs text-text-secondary">
                      {slotGarments.length} {slotGarments.length === 1 ? 'prenda' : 'prendas'}
                    </p>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        void updateCalendarEntry(entry.id, {
                          wornAt: entry.wornAt ? null : new Date().toISOString(),
                        })
                      }
                      aria-label={entry.wornAt ? 'Desmarcar vestido' : 'Marcar como vestido'}
                      data-testid="toggle-worn"
                      className={`flex h-10 items-center gap-1 rounded-full px-3 text-xs font-bold transition-colors ${
                        entry.wornAt
                          ? 'bg-success/15 text-success'
                          : 'bg-surface-alt text-text-secondary hover:bg-primary-soft hover:text-primary'
                      }`}
                    >
                      <CheckIcon size={16} />
                      {entry.wornAt ? 'Vestido' : 'Vestir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryToDelete(entry)}
                      aria-label="Quitar del calendario"
                      className="flex h-10 w-10 items-center justify-center rounded-full text-danger hover:bg-danger/10"
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

      {/* Mini mes + historial */}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="card-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthAnchor((d) => addDays(d, -30))}
              aria-label="Mes anterior"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
            >
              <ChevronLeftIcon size={16} />
            </button>
            <p className="text-sm font-semibold">{monthYearLabel(monthAnchor)}</p>
            <button
              type="button"
              onClick={() => setMonthAnchor((d) => addDays(d, 30))}
              aria-label="Mes siguiente"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => (
              <span key={i} className="py-1 text-[10px] font-semibold uppercase text-text-muted">
                {label}
              </span>
            ))}
            {monthMatrix.map((dateOnly) => {
              const has = datesWithEntries.has(dateOnly);
              const isToday = dateOnly === today();
              const isSelected = dateOnly === selectedDate;
              return (
                <button
                  key={dateOnly}
                  type="button"
                  onClick={() => {
                    setSelectedDate(dateOnly);
                    const date = parseDateOnly(dateOnly);
                    const currentMonday = startOfWeek(new Date());
                    const targetMonday = startOfWeek(date);
                    const diff = Math.round(
                      (targetMonday.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000),
                    );
                    setWeekOffset(diff);
                  }}
                  className={`flex h-9 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-primary text-white'
                      : isToday
                        ? 'text-primary'
                        : 'text-text-primary hover:bg-surface-alt'
                  }`}
                >
                  {dateOnly.slice(-2)}
                  {has && !isSelected && (
                    <span className="ml-0.5 h-1 w-1 rounded-full bg-primary" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="card-surface p-4">
          <h3 className="mb-3 font-heading text-base">Usados recientemente</h3>
          {wornHistory.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Marca un outfit como «vestido» para verlo aquí.
            </p>
          ) : (
            <ul className="space-y-2">
              {wornHistory.map((entry) => {
                const outfit = outfits.find((o) => o.id === entry.outfitId);
                return (
                  <li key={entry.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{outfit?.name ?? 'Outfit'}</span>
                    <span className="ml-2 shrink-0 text-xs text-text-muted">{entry.date}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={entryToDelete !== null}
        title="¿Quitar del calendario?"
        message="El outfit deja de estar programado para ese día, pero no se elimina."
        confirmLabel="Quitar"
        onConfirm={() => entryToDelete && void deleteCalendarEntry(entryToDelete.id)}
        onClose={() => setEntryToDelete(null)}
      />
    </div>
  );
}

function buildMonthMatrix(anchor: Date): string[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const monday = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(monday, i);
    // Solo celdas del mes visible para compactar el mini-calendario.
    return day.getMonth() === month ? toDateOnly(day) : `__pad_${i}`;
  }).filter((value) => !value.startsWith('__pad_'));
}
