'use client';

/**
 * Outfit Builder: filas por categoría con ciclado ‹ › de prendas,
 * orden editable y campos nombre/notas/fecha opcional.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { createOutfit, createCalendarEntry } from '@/lib/local/repositories';
import {
  CATEGORY_LABELS,
  GARMENT_CATEGORIES,
} from '@/lib/domain/constants';
import type { Garment, OutfitSlot } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { Button, Chip, Field, TextArea, TextInput } from '@/components/ui';

const EMPTY_GARMENTS: Garment[] = [];

export default function OutfitBuilderPage() {
  const router = useRouter();
  const { profile } = useSession();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [slots, setSlots] = useState<OutfitSlot[]>([]);
  const [customCategory, setCustomCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const garments = useLiveQuery(
    async () =>
      profile
        ? (await getDB().garments.where('userId').equals(profile.userId).toArray()).filter(
            (g) => !g.deletedAt && !g.archived,
          )
        : [],
    [profile?.userId],
  ) as Garment[] | undefined;

  const garmentList = garments ?? EMPTY_GARMENTS;
  const byCategory = useMemo(() => {
    const map = new Map<string, Garment[]>();
    for (const garment of garmentList) {
      const list = map.get(garment.category) ?? [];
      list.push(garment);
      map.set(garment.category, list);
    }
    return map;
  }, [garmentList]);

  const usedCategories = new Set(slots.map((s) => s.category));
  const availableCategories = [
    ...GARMENT_CATEGORIES.filter((c) => !usedCategories.has(c)),
    ...[...byCategory.keys()].filter((c) => !GARMENT_CATEGORIES.includes(c as never) && !usedCategories.has(c)),
  ].sort();

  function addRow(category: string) {
    const candidates = byCategory.get(category) ?? [];
    setSlots((current) => [
      ...current,
      { category, garmentId: candidates[0]?.id ?? null },
    ]);
  }

  function removeRow(index: number) {
    setSlots((current) => current.filter((_, i) => i !== index));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setSlots((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [row] = copy.splice(index, 1);
      copy.splice(target, 0, row!);
      return copy;
    });
  }

  function cycle(index: number, direction: -1 | 1) {
    setSlots((current) => {
      const row = current[index];
      if (!row) return current;
      const candidates = byCategory.get(row.category) ?? [];
      if (candidates.length === 0) return current;
      const currentPos = candidates.findIndex((g) => g.id === row.garmentId);
      const nextPos = (currentPos + direction + candidates.length * 2) % candidates.length;
      const next = candidates[nextPos]!;
      const copy = [...current];
      copy[index] = { ...row, garmentId: next.id };
      return copy;
    });
  }

  async function handleSave() {
    if (!profile) return;
    setError(null);
    if (slots.length === 0) {
      setError('Añade al menos una prenda al outfit');
      return;
    }
    setSaving(true);
    try {
      const outfit = await createOutfit(profile.userId, {
        name: name || null,
        notes: notes || null,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el outfit');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Crear outfit</h1>
        <button
          type="button"
          onClick={() => router.push('/outfits')}
          aria-label="Cancelar"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <XIcon size={20} />
        </button>
      </div>

      <div className="space-y-5">
        <Field label="Nombre">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Look de oficina"
            maxLength={80}
          />
        </Field>

        {/* Slots */}
        <div className="space-y-3">
          {slots.map((slot, index) => {
            const garment = garments?.find((g) => g.id === slot.garmentId);
            const candidates = byCategory.get(slot.category) ?? [];
            return (
              <div
                key={`${slot.category}-${index}`}
                className="card-surface flex items-center gap-3 p-3"
                data-testid="outfit-slot"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveRow(index, -1)}
                    disabled={index === 0}
                    aria-label="Subir"
                    className="rounded p-1 text-text-muted hover:bg-surface-alt disabled:opacity-30"
                  >
                    <ChevronLeftIcon size={14} className="rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(index, 1)}
                    disabled={index === slots.length - 1}
                    aria-label="Bajar"
                    className="rounded p-1 text-text-muted hover:bg-surface-alt disabled:opacity-30"
                  >
                    <ChevronLeftIcon size={14} className="-rotate-90" />
                  </button>
                </div>

                <GarmentPhoto
                  imageId={garment?.photoId ?? null}
                  alt={garment?.name ?? slot.category}
                  className="h-20 w-20 shrink-0 object-cover"
                  iconSize={24}
                />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {CATEGORY_LABELS[slot.category] ?? slot.category}
                  </p>
                  <p className="truncate text-sm font-semibold">
                    {garment?.name ?? 'Sin prendas de esta categoría'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => cycle(index, -1)}
                    disabled={candidates.length < 2}
                    aria-label="Prenda anterior"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                  >
                    <ChevronLeftIcon size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => cycle(index, 1)}
                    disabled={candidates.length < 2}
                    aria-label="Prenda siguiente"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt disabled:opacity-30"
                  >
                    <ChevronRightIcon size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label="Quitar fila"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-danger hover:bg-danger/10"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}

          {slots.length === 0 && (
            <div className="card-surface flex flex-col items-center gap-2 p-8 text-center">
              <SparklesIcon size={28} className="text-text-muted" />
              <p className="text-sm text-text-secondary">
                Añade filas por categoría y elige tus prendas
              </p>
            </div>
          )}
        </div>

        {/* Añadir fila */}
        {availableCategories.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Añadir categoría
            </p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {availableCategories.map((category) => (
                <Chip key={category} onClick={() => addRow(category)}>
                  <PlusIcon size={14} />
                  {CATEGORY_LABELS[category] ?? category}
                </Chip>
              ))}
              {customCategory.trim() && (
                <Chip onClick={() => { addRow(customCategory.trim()); setCustomCategory(''); }}>
                  <PlusIcon size={14} />
                  {customCategory.trim()}
                </Chip>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <TextInput
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Otra categoría…"
                className="flex-1"
                aria-label="Categoría personalizada"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => { addRow(customCategory.trim()); setCustomCategory(''); }}
                disabled={!customCategory.trim()}
                aria-label="Añadir categoría personalizada"
              >
                <PlusIcon size={16} />
              </Button>
            </div>
          </div>
        )}

        <Field label="Notas">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Occasión, temporada…"
            maxLength={2000}
          />
        </Field>

        <Field label="Programar en el calendario" hint="Opcional">
          <TextInput
            type="date"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => router.push('/outfits')}
          >
            Cancelar
          </Button>
          <Button className="flex-1" loading={saving} onClick={handleSave} data-testid="save-outfit">
            Guardar outfit
          </Button>
        </div>
      </div>
    </div>
  );
}
