'use client';

/**
 * Detalle de outfit: composición apilada, editar slots (ciclar ‹ ›),
 * eliminar y programar en calendario.
 */
import { useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { deleteOutfit, updateOutfit, createCalendarEntry } from '@/lib/local/repositories';
import { CATEGORY_LABELS } from '@/lib/domain/constants';
import type { Garment, Outfit } from '@/lib/domain/types';
import { GarmentPhoto } from '@/components/garment-photo';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, Field, TextInput } from '@/components/ui';
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  ShareIcon,
  TrashIcon,
} from '@/components/icons';

export default function OutfitDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { profile } = useSession();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(searchParams.get('date') ?? '');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const data = useLiveQuery(
    async () => {
      if (!params?.id || !profile) return null;
      const db = getDB();
      const [outfit, garments] = await Promise.all([
        db.outfits.get(params.id),
        db.garments.where('userId').equals(profile.userId).toArray(),
      ]);
      return { outfit, garments };
    },
    [params?.id, profile?.userId],
  );

  const outfit = data?.outfit as Outfit | undefined;
  const allGarments = useMemo(() => ((data?.garments ?? []) as Garment[]).filter((g) => !g.deletedAt), [data]);
  const garmentList = useMemo(() => allGarments.filter((g) => !g.archived), [allGarments]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Garment[]>();
    for (const garment of garmentList) {
      const list = map.get(garment.category) ?? [];
      list.push(garment);
      map.set(garment.category, list);
    }
    return map;
  }, [garmentList]);

  if (!profile) return null;
  if (data === null || data === undefined) {
    return <div className="card-surface mx-auto h-96 max-w-xl animate-pulse" aria-label="Cargando" />;
  }
  if (!outfit || outfit.deletedAt) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <p className="text-text-secondary">Este conjunto ya no existe.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push('/outfits')}>
          Ver conjuntos
        </Button>
      </div>
    );
  }

  function cycleSlot(index: number, direction: -1 | 1) {
    const slot = outfit!.slots[index]!;
    const candidates = byCategory.get(slot.category) ?? [];
    if (candidates.length === 0) return;
    const pos = candidates.findIndex((g) => g.id === slot.garmentId);
    const nextPos = (pos + direction + candidates.length * 2) % candidates.length;
    const next = candidates[nextPos]!;
    const slots = [...outfit!.slots];
    slots[index] = { ...slot, garmentId: next.id };
    void updateOutfit(outfit!.id, { slots });
  }

  async function handleDelete() {
    await deleteOutfit(outfit!.id);
    router.push('/outfits');
  }

  async function handleSchedule() {
    if (!scheduleDate) return;
    await createCalendarEntry(profile!.userId, {
      date: scheduleDate,
      outfitId: outfit!.id,
      notes: null,
      wornAt: null,
    });
    router.push('/calendar');
  }

  function handleShare() {
    const url = `${window.location.origin}/share/outfit/${outfit!.shareableId}`;
    setShareUrl(url);
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  async function saveName() {
    await updateOutfit(outfit!.id, { name: name.trim() || null });
    setEditing(false);
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/outfits')}
          aria-label="Volver"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <ArrowLeftIcon size={20} />
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleShare}
            aria-label="Compartir conjunto"
            data-testid="share-outfit"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <ShareIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Eliminar conjunto"
            data-testid="delete-outfit"
            className="flex h-11 w-11 items-center justify-center rounded-full text-danger hover:bg-danger/10"
          >
            <TrashIcon size={20} />
          </button>
        </div>
      </div>

      <div className="card-surface space-y-5 p-5" data-testid="outfit-detail">
        <div>
          {editing ? (
            <div className="flex gap-2">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                aria-label="Nombre del conjunto"
              />
              <Button size="md" onClick={saveName}>
                Guardar
              </Button>
            </div>
          ) : (
            <h1
              className="font-heading text-2xl"
              onDoubleClick={() => {
                setName(outfit.name ?? '');
                setEditing(true);
              }}
              data-testid="outfit-name"
            >
              {outfit.name ?? 'Conjunto sin nombre'}
              <button
                type="button"
                onClick={() => {
                  setName(outfit.name ?? '');
                  setEditing(true);
                }}
                aria-label="Editar nombre"
                className="ml-2 inline-flex align-middle text-text-muted hover:text-primary"
              >
                <PencilIcon size={16} />
              </button>
            </h1>
          )}
          {outfit.notes && (
            <p className="mt-2 whitespace-pre-line text-sm text-text-secondary">{outfit.notes}</p>
          )}
        </div>

        {/* Composición: filas apiladas */}
        <div className="space-y-3">
          {outfit.slots.map((slot, index) => {
            const garment = allGarments.find((g) => g.id === slot.garmentId);
            const candidates = byCategory.get(slot.category) ?? [];
            return (
              <div key={`${slot.category}-${index}`} className="flex items-center gap-3 rounded-xl bg-surface-alt/60 p-3">
                <GarmentPhoto
                  imageId={garment?.photoId ?? null}
                  alt={garment?.name ?? slot.category}
                  className="h-20 w-20 shrink-0 bg-surface object-cover"
                  iconSize={22}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {CATEGORY_LABELS[slot.category] ?? slot.category}
                  </p>
                  <p className="truncate text-sm font-semibold">
                    {garment?.name ?? 'Sin prenda'}
                  </p>
                  {garment && (
                    <button
                      type="button"
                      onClick={() => router.push(`/wardrobe/${garment.id}`)}
                      className="text-xs font-semibold text-primary hover:text-primary-hover"
                    >
                      Ver prenda
                    </button>
                  )}
                </div>
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => cycleSlot(index, -1)}
                    disabled={candidates.length < 2}
                    aria-label="Alternar prenda anterior"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface disabled:opacity-30"
                  >
                    <ChevronLeftIcon size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => cycleSlot(index, 1)}
                    disabled={candidates.length < 2}
                    aria-label="Alternar prenda siguiente"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface disabled:opacity-30"
                  >
                    <ChevronRightIcon size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Programar */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Programar en fecha">
              <TextInput
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            onClick={handleSchedule}
            disabled={!scheduleDate}
            data-testid="schedule-outfit"
          >
            <CalendarIcon size={18} />
            Programar
          </Button>
        </div>

        {shareUrl && (
          <div className="rounded-xl bg-primary-soft p-3 text-xs text-primary" data-testid="share-url" role="status">
            Enlace copiado: {shareUrl}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar conjunto?"
        message={`"${outfit.name ?? 'Este conjunto'}" se eliminará. Las prendas no se ven afectadas.`}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
