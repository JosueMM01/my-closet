'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { createCalendarEntry, createOutfit } from '@/lib/local/repositories';
import { CATEGORY_LABELS, GARMENT_CATEGORIES } from '@/lib/domain/constants';
import type { Garment, OutfitSlot } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { Button, Field, TextArea, TextInput } from '@/components/ui';

const EMPTY_GARMENTS: Garment[] = [];
const CATEGORY_ORDER = new Map<string, number>(
  GARMENT_CATEGORIES.map((category, index) => [category, index]),
);

export default function OutfitBuilderPage() {
  return (
    <Suspense
      fallback={<div className="card-surface mx-auto h-96 max-w-2xl animate-pulse" aria-label="Cargando editor" />}
    >
      <OutfitBuilder />
    </Suspense>
  );
}

function OutfitBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useSession();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduleDate, setScheduleDate] = useState(() => searchParams.get('date') ?? '');
  const [slots, setSlots] = useState<OutfitSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const garments = useLiveQuery(
    async () =>
      profile
        ? (await getDB().garments.where('userId').equals(profile.userId).toArray()).filter(
            (garment) => !garment.deletedAt && !garment.archived,
          )
        : [],
    [profile?.userId],
  ) as Garment[] | undefined;

  const garmentList = garments ?? EMPTY_GARMENTS;
  const byCategory = useMemo(() => {
    const map = new Map<string, Garment[]>();
    for (const garment of garmentList) {
      const candidates = map.get(garment.category) ?? [];
      candidates.push(garment);
      map.set(garment.category, candidates);
    }
    return map;
  }, [garmentList]);

  const usedCategories = new Set(slots.map((slot) => slot.category));
  const availableCategories = [...byCategory.keys()]
    .filter((category) => !usedCategories.has(category))
    .sort(
      (left, right) =>
        (CATEGORY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (CATEGORY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
    );

  function addRow(category: string) {
    const firstGarment = byCategory.get(category)?.[0];
    if (!firstGarment) return;
    setSlots((current) => [...current, { category, garmentId: firstGarment.id }]);
  }

  function removeRow(index: number) {
    setSlots((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function cycle(index: number, direction: -1 | 1) {
    setSlots((current) => {
      const row = current[index];
      if (!row) return current;
      const candidates = byCategory.get(row.category) ?? [];
      if (candidates.length < 2) return current;
      const currentPosition = candidates.findIndex((garment) => garment.id === row.garmentId);
      const nextPosition =
        (currentPosition + direction + candidates.length * 2) % candidates.length;
      const nextGarment = candidates[nextPosition]!;
      const nextSlots = [...current];
      nextSlots[index] = { ...row, garmentId: nextGarment.id };
      return nextSlots;
    });
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setError(null);
    if (slots.length === 0) {
      setError('Añade al menos una prenda al conjunto');
      return;
    }

    setSaving(true);
    try {
      const outfit = await createOutfit(profile.userId, {
        name: name.trim() || null,
        notes: notes.trim() || null,
        slots,
      });
      if (scheduleDate) {
        await createCalendarEntry(profile.userId, {
          date: scheduleDate,
          outfitId: outfit.id,
          notes: null,
          wornAt: null,
        });
      }
      router.push(`/outfits/${outfit.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el conjunto');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-text-primary">
          Crear conjunto
        </h1>
        <button
          type="button"
          onClick={() => router.push('/outfits')}
          aria-label="Cancelar"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <XIcon size={22} />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="card-surface overflow-hidden p-4 sm:p-6">
          <div className="grid min-h-72 grid-cols-2 gap-3 rounded-3xl bg-surface-alt p-4 sm:min-h-96">
            {slots.length === 0 ? (
              <div className="col-span-2 flex flex-col items-center justify-center text-center text-text-muted">
                <SparklesIcon size={44} className="mb-3 opacity-50" />
                <p className="font-semibold">Aún no has seleccionado prendas</p>
                <p className="mt-1 max-w-xs text-sm">
                  Añade una categoría para empezar a combinar tu armario.
                </p>
              </div>
            ) : (
              slots.map((slot, index) => {
                const garment = garmentList.find((candidate) => candidate.id === slot.garmentId);
                return (
                  <div
                    key={`${slot.category}-${index}`}
                    className="relative min-h-32 overflow-hidden rounded-2xl bg-surface"
                  >
                    <GarmentPhoto
                      imageId={garment?.photoId ?? null}
                      alt={garment?.name ?? CATEGORY_LABELS[slot.category] ?? slot.category}
                      className="h-full w-full object-contain p-2"
                      iconSize={30}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        <section aria-labelledby="selected-categories-title">
          <h2 id="selected-categories-title" className="mb-3 font-heading text-lg">
            Prendas del conjunto
          </h2>
          {slots.length > 0 ? (
            <div className="space-y-3">
              {slots.map((slot, index) => {
                const candidates = byCategory.get(slot.category) ?? [];
                const garment = garmentList.find((candidate) => candidate.id === slot.garmentId);
                const categoryLabel = CATEGORY_LABELS[slot.category] ?? slot.category;
                return (
                  <div
                    key={`${slot.category}-${index}`}
                    className="card-surface flex items-center gap-3 p-3"
                  >
                    <GarmentPhoto
                      imageId={garment?.photoId ?? null}
                      alt={garment?.name ?? categoryLabel}
                      className="h-16 w-16 shrink-0 object-cover"
                      iconSize={20}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {categoryLabel}
                      </p>
                      <p className="truncate text-sm font-semibold">
                        {garment?.name ?? 'Sin prenda'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cycle(index, -1)}
                      disabled={candidates.length < 2}
                      aria-label={`Prenda anterior de ${categoryLabel}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                    >
                      <ChevronLeftIcon size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => cycle(index, 1)}
                      disabled={candidates.length < 2}
                      aria-label={`Prenda siguiente de ${categoryLabel}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                    >
                      <ChevronRightIcon size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      aria-label={`Quitar ${categoryLabel}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-danger hover:bg-danger/10"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="add-category-title">
          <h2 id="add-category-title" className="mb-3 font-heading text-lg">
            Añadir categoría
          </h2>
          {garments === undefined ? (
            <div className="card-surface h-16 animate-pulse" aria-label="Cargando prendas" />
          ) : availableCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => addRow(category)}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-text-secondary transition-colors hover:border-primary hover:text-primary"
                >
                  <PlusIcon size={16} />
                  {CATEGORY_LABELS[category] ?? category}
                </button>
              ))}
            </div>
          ) : (
            <p className="card-surface p-4 text-sm text-text-secondary">
              Añade prendas a tu armario para crear nuevas combinaciones.
            </p>
          )}
        </section>

        <div className="card-surface space-y-4 p-5">
          <Field label="Nombre" hint="Opcional">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Por ejemplo, oficina"
            />
          </Field>
          <Field label="Notas" hint="Opcional">
            <TextArea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Añade detalles sobre este conjunto"
            />
          </Field>
          <Field label="Programar en el calendario" hint="Opcional">
            <div className="relative">
              <CalendarIcon
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <TextInput
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                className="pl-10"
              />
            </div>
          </Field>
        </div>

        {error ? (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={saving} data-testid="save-outfit">
          Guardar conjunto
        </Button>
      </form>
    </div>
  );
}
