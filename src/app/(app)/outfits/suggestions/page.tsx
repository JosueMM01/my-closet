'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { GarmentPhoto } from '@/components/garment-photo';
import { ArrowLeftIcon, CheckIcon, SparklesIcon } from '@/components/icons';
import { useSession } from '@/components/providers';
import { Button, EmptyState, Field, Select } from '@/components/ui';
import { CATEGORY_LABELS } from '@/lib/domain/constants';
import {
  DEFAULT_RECOMMENDATION_CONTEXT,
  recommendOutfits,
  type RecommendationContext,
} from '@/lib/domain/recommendations';
import type { Garment } from '@/lib/domain/types';
import { getDB } from '@/lib/local/db';
import {
  clearRecommendationContext,
  getRecommendationContext,
  setRecommendationContext,
} from '@/lib/local/kv';
import { createOutfit } from '@/lib/local/repositories';

const OCCASION_LABELS: Record<RecommendationContext['occasion'], string> = {
  casual: 'Casual',
  work: 'Trabajo',
  formal: 'Formal',
  active: 'Actividad',
};

const TEMPERATURE_LABELS: Record<RecommendationContext['temperature'], string> = {
  cold: 'Frío',
  mild: 'Templado',
  warm: 'Cálido',
};

const STYLE_LABELS: Record<RecommendationContext['style'], string> = {
  classic: 'Clásico',
  minimal: 'Minimalista',
  colorful: 'Colorido',
};

function signature(ids: readonly (string | null)[]): string {
  return ids.filter((id): id is string => id !== null).sort().join('|');
}

export default function OutfitSuggestionsPage() {
  const { profile } = useSession();
  const [variationSeed, setVariationSeed] = useState(0);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useLiveQuery(
    async () => {
      if (!profile) return null;
      const db = getDB();
      const [garments, outfits, calendarEntries, context] = await Promise.all([
        db.garments.where('userId').equals(profile.userId).toArray(),
        db.outfits.where('userId').equals(profile.userId).toArray(),
        db.calendarEntries.where('userId').equals(profile.userId).toArray(),
        getRecommendationContext(profile.userId),
      ]);
      return { garments, outfits, calendarEntries, context };
    },
    [profile?.userId],
  );

  const context = data?.context ?? DEFAULT_RECOMMENDATION_CONTEXT;
  const suggestions = useMemo(() => {
    if (!profile || !data) return [];
    return recommendOutfits({
      userId: profile.userId,
      context,
      garments: data.garments,
      outfits: data.outfits,
      calendarEntries: data.calendarEntries,
      variationSeed,
    });
  }, [context, data, profile, variationSeed]);
  const garmentById = useMemo(
    () => new Map((data?.garments ?? []).map((garment) => [garment.id, garment])),
    [data?.garments],
  );
  const savedSignatures = useMemo(
    () => new Set(
      (data?.outfits ?? [])
        .filter((outfit) => !outfit.deletedAt)
        .map((outfit) => signature(outfit.slots.map((slot) => slot.garmentId))),
    ),
    [data?.outfits],
  );

  if (!profile) return null;

  function updateContext(patch: Partial<RecommendationContext>): void {
    setError(null);
    setVariationSeed(0);
    void setRecommendationContext(profile!.userId, { ...context, ...patch }).catch(() => {
      setError('No se pudo guardar el contexto en este dispositivo.');
    });
  }

  function resetContext(): void {
    setError(null);
    setVariationSeed(0);
    void clearRecommendationContext(profile!.userId).catch(() => {
      setError('No se pudo restablecer el contexto.');
    });
  }

  async function saveSuggestion(key: string): Promise<void> {
    const suggestion = suggestions.find((candidate) => candidate.key === key);
    if (!suggestion || savedSignatures.has(key)) return;
    setSavingKey(key);
    setError(null);
    try {
      await createOutfit(profile!.userId, {
        name: `Sugerencia ${OCCASION_LABELS[context.occasion].toLocaleLowerCase('es')}`,
        notes: 'Creado desde sugerencias locales',
        slots: suggestion.slots,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el conjunto.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <Link
          href="/outfits"
          aria-label="Volver a conjuntos"
          className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <ArrowLeftIcon size={20} />
        </Link>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Inspiración local</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Ideas para vestirte</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
            Estas sugerencias se crean únicamente en este dispositivo con tu armario e historial local.
            No analizan fotos ni necesitan conexión.
          </p>
        </div>
      </header>

      <section className="card-surface p-4 sm:p-6" aria-labelledby="context-title">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 id="context-title" className="font-heading text-xl">¿Qué necesitas hoy?</h2>
            <p className="mt-1 text-xs text-text-muted">El contexto queda guardado solo en este dispositivo.</p>
          </div>
          <button type="button" onClick={resetContext} className="text-sm font-semibold text-primary hover:underline">
            Restablecer
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Ocasión">
            <Select
              value={context.occasion}
              onChange={(event) => updateContext({ occasion: event.target.value as RecommendationContext['occasion'] })}
            >
              {Object.entries(OCCASION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Temperatura">
            <Select
              value={context.temperature}
              onChange={(event) => updateContext({ temperature: event.target.value as RecommendationContext['temperature'] })}
            >
              {Object.entries(TEMPERATURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Estilo">
            <Select
              value={context.style}
              onChange={(event) => updateContext({ style: event.target.value as RecommendationContext['style'] })}
            >
              {Object.entries(STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Clima">
            <button
              type="button"
              aria-pressed={context.rain}
              onClick={() => updateContext({ rain: !context.rain })}
              className={`flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-colors ${
                context.rain
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-surface text-text-secondary hover:bg-surface-alt'
              }`}
            >
              {context.rain ? 'Puede llover' : 'Sin lluvia'}
            </button>
          </Field>
        </div>
      </section>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      {data === undefined ? (
        <div className="grid gap-4 lg:grid-cols-3" aria-label="Preparando sugerencias">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="card-surface h-96 animate-pulse" />)}
        </div>
      ) : suggestions.length === 0 ? (
        <EmptyState
          icon={<SparklesIcon size={28} />}
          title="Faltan prendas para una combinación completa"
          description="Necesitas calzado y, además, un vestido o una parte de arriba con una parte de abajo."
          action={<Link href="/wardrobe" className="font-semibold text-primary hover:underline">Revisar mi armario</Link>}
        />
      ) : (
        <section aria-labelledby="suggestions-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="suggestions-title" className="font-heading text-2xl">Tus combinaciones</h2>
              <p className="mt-1 text-sm text-text-secondary">Elige una para guardarla; nada se guarda automáticamente.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setVariationSeed((current) => current + 1)}
              data-testid="other-suggestions"
            >
              <SparklesIcon size={17} />
              Otras opciones
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {suggestions.map((suggestion, index) => {
              const suggestionGarments = suggestion.slots
                .map((slot) => garmentById.get(slot.garmentId ?? ''))
                .filter((garment): garment is Garment => garment !== undefined);
              const saved = savedSignatures.has(suggestion.key);
              return (
                <article key={suggestion.key} className="card-surface flex min-w-0 flex-col overflow-hidden" data-testid="suggestion-card">
                  <div className="grid min-h-56 grid-cols-2 gap-2 bg-surface-alt p-3">
                    {suggestionGarments.map((garment) => (
                      <div key={garment.id} className="relative min-h-24 overflow-hidden rounded-2xl bg-surface">
                        <GarmentPhoto
                          imageId={garment.photoId}
                          alt={garment.name ?? CATEGORY_LABELS[garment.category] ?? 'Prenda'}
                          className="h-full w-full object-contain p-2"
                          rounded="rounded-2xl"
                          iconSize={26}
                        />
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-surface/90 px-2 py-1 text-[10px] font-semibold text-text-secondary backdrop-blur">
                          {CATEGORY_LABELS[garment.category] ?? garment.category}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Opción {index + 1}</p>
                    <h3 className="mt-1 font-heading text-xl">{OCCASION_LABELS[context.occasion]}</h3>
                    <ul className="mt-3 flex-1 space-y-2 text-sm text-text-secondary">
                      {suggestion.reasons.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <CheckIcon size={16} className="mt-0.5 shrink-0 text-success" />
                          <span className="first-letter:uppercase">{reason}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      className="mt-5 w-full"
                      variant={saved ? 'secondary' : 'primary'}
                      disabled={saved}
                      loading={savingKey === suggestion.key}
                      onClick={() => void saveSuggestion(suggestion.key)}
                      data-testid="save-suggestion"
                    >
                      {saved ? <><CheckIcon size={17} /> Guardado</> : 'Guardar conjunto'}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
