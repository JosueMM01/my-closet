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

  // If slots are empty, initialize with some default categories if available
  if (slots.length === 0 && garmentList.length > 0) {
    const defaultCategories = ['tops', 'bottoms', 'shoes'];
    const initialSlots: OutfitSlot[] = [];
    defaultCategories.forEach(cat => {
      const candidates = byCategory.get(cat) ?? [];
      if (candidates.length > 0) {
        initialSlots.push({ category: cat, garmentId: candidates[0]!.id });
      }
    });
    if (initialSlots.length > 0) {
      setSlots(initialSlots);
    }
  }

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
        name: name || 'My New Outfit',
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
    <div className="flex flex-col h-[calc(100vh-6rem)] -mx-4 md:mx-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Create Outfit</h1>
        <button
          type="button"
          onClick={() => router.push('/outfits')}
          aria-label="Cancelar"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <XIcon size={24} />
        </button>
      </div>

      <div className="flex-1 flex flex-col px-4 space-y-6 overflow-y-auto no-scrollbar pb-24">
        {/* Collage Area */}
        <div className="relative aspect-[3/4] md:aspect-square w-full rounded-[2rem] bg-[#F3EFEA] overflow-hidden flex flex-col shadow-soft border border-border/50">
          <div className="absolute top-4 right-4 z-20 flex gap-2">
            <button className="h-10 px-4 rounded-full bg-white/70 backdrop-blur text-sm font-semibold text-text-primary shadow-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              Shuffle
            </button>
          </div>
          
          <div className="flex-1 relative w-full h-full p-4 flex items-center justify-center">
            {slots.length === 0 ? (
              <div className="text-text-muted flex flex-col items-center">
                <SparklesIcon size={48} className="mb-2 opacity-50" />
                <p className="font-medium">No items selected</p>
              </div>
            ) : (
              <div className="w-full h-full relative">
                {slots.map((slot, i) => {
                  const garment = garments?.find((g) => g.id === slot.garmentId);
                  if (!garment) return null;
                  
                  // Simple collage positioning based on index
                  let positionClass = "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2/3 h-2/3 z-10";
                  if (slots.length > 1) {
                    if (i === 0) positionClass = "top-[10%] left-[10%] w-[55%] h-[50%] z-20"; // Usually tops
                    else if (i === 1) positionClass = "bottom-[10%] right-[10%] w-[55%] h-[50%] z-10"; // Usually bottoms
                    else if (i === 2) positionClass = "top-[40%] right-[5%] w-[40%] h-[40%] z-30"; // Usually accessories/shoes
                    else positionClass = `top-[${(i+1)*10}%] left-[${(i+1)*10}%] w-1/3 h-1/3 z-[${30+i}]`;
                  }
                  
                  return (
                    <div key={`${slot.category}-${i}`} className={`absolute ${positionClass} transition-all duration-500`}>
                       <GarmentPhoto
                        imageId={garment.photoId}
                        alt={garment.name ?? slot.category}
                        className="w-full h-full object-contain filter drop-shadow-md"
                        iconSize={32}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="absolute bottom-4 left-0 right-0 px-4 flex justify-between gap-3 z-20">
            <Button
              className="flex-1 bg-white text-text-primary hover:bg-white/90 border border-border"
              onClick={() => {}}
            >
              <CalendarIcon size={18} className="mr-1" /> Plan It
            </Button>
            <Button
              className="flex-1"
              loading={saving}
              onClick={handleSave}
            >
              Save Outfit
            </Button>
          </div>
        </div>

        {/* Categories Carousel */}
        <div className="no-scrollbar flex gap-4 overflow-x-auto pb-4 pt-2 -mx-4 px-4 snap-x">
          {slots.map((slot, index) => {
            const garment = garments?.find((g) => g.id === slot.garmentId);
            return (
              <div key={`${slot.category}-${index}`} className="flex flex-col items-center gap-2 snap-center w-24 shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  {CATEGORY_LABELS[slot.category] ?? slot.category}
                </p>
                <div className="relative group">
                  <div className="h-24 w-24 rounded-2xl bg-surface-alt border border-border overflow-hidden relative shadow-sm">
                    <GarmentPhoto
                      imageId={garment?.photoId ?? null}
                      alt={garment?.name ?? slot.category}
                      className="h-full w-full object-cover"
                      iconSize={24}
                    />
                  </div>
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2">
                    <button onClick={() => cycle(index, -1)} className="h-6 w-6 rounded-full bg-white shadow flex items-center justify-center text-text-secondary hover:text-primary">
                      <ChevronLeftIcon size={14} />
                    </button>
                  </div>
                  <div className="absolute -right-3 top-1/2 -translate-y-1/2">
                    <button onClick={() => cycle(index, 1)} className="h-6 w-6 rounded-full bg-white shadow flex items-center justify-center text-text-secondary hover:text-primary">
                      <ChevronRightIcon size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          
          {/* Add Category Button */}
          {availableCategories.length > 0 && (
            <div className="flex flex-col items-center justify-center gap-2 snap-center shrink-0 pl-2">
              <button
                type="button"
                onClick={() => addRow(availableCategories[0]!)}
                className="h-24 w-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-text-muted hover:border-primary hover:text-primary transition-colors"
              >
                <PlusIcon size={24} />
              </button>
            </div>
          )}
        </div>
        
        {error && (
          <p role="alert" className="text-sm text-danger text-center">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
