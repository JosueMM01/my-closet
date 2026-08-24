'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
} from '@/lib/domain/constants';
import type { Garment, ImageRecord } from '@/lib/domain/types';
import {
  ImageProcessingError,
  ImageValidationError,
  replaceLocalImageBlob,
  saveGarmentPhoto,
} from '@/lib/images/image-client';
import type { ImageProgress } from '@/lib/images/worker-protocol';
import { createGarment, updateGarment } from '@/lib/local/repositories';
import { queueProcessedImage } from '@/lib/local/sync-engine';
import { useImageUrl } from './garment-photo';
import { CameraIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';
import { ImageEditor, type ImageEditorUpdate } from './image-editor';
import { Button, Chip, Field, TextArea, TextInput } from './ui';

interface FormState {
  name: string;
  category: string;
  colors: string[];
  brand: string;
  notes: string;
}

function toFormState(garment?: Garment): FormState {
  return {
    name: garment?.name ?? '',
    category: garment?.category ?? 'tops',
    colors: garment?.colors ?? [],
    brand: garment?.brand ?? '',
    notes: garment?.notes ?? '',
  };
}

export function GarmentForm({
  userId,
  garment,
}: {
  userId: string;
  garment?: Garment;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingControllerRef = useRef<AbortController>(null);
  const [form, setForm] = useState<FormState>(() => toFormState(garment));
  const [photo, setPhoto] = useState<ImageRecord | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<Blob | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<ImageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [customCategoryOpen, setCustomCategoryOpen] = useState(false);
  const [customColor, setCustomColor] = useState('');
  const [customColorOpen, setCustomColorOpen] = useState(false);

  const isCustomCategory = !GARMENT_CATEGORIES.some((category) => category === form.category);
  const visiblePhotoId = photo?.id ?? (removeExistingPhoto ? null : (garment?.photoId ?? null));
  const existingPhotoUrl = useImageUrl(visiblePhotoId);
  const hasPhoto = visiblePhotoId !== null;
  const canEditPhoto = Boolean(photo?.blob && originalPhoto && removeBackground);

  useEffect(() => () => processingControllerRef.current?.abort(), []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    processingControllerRef.current?.abort();
    setEditorOpen(false);
    const controller = new AbortController();
    processingControllerRef.current = controller;
    setError(null);
    setPhotoBusy(true);
    setPhotoProgress({ stage: 'Preparando imagen', current: null, total: null });
    try {
      const record = await saveGarmentPhoto(userId, file, {
        removeBackground,
        queueForSync: false,
        signal: controller.signal,
        onProgress: setPhotoProgress,
      });
      setPhoto(record);
      setOriginalPhoto(file);
      setRemoveExistingPhoto(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('Procesamiento cancelado. La foto anterior no se modificó.');
      } else {
        setError(
          caught instanceof ImageValidationError || caught instanceof ImageProcessingError
            ? caught.message
            : 'No se pudo procesar la imagen. Prueba con otra foto.',
        );
      }
    } finally {
      if (processingControllerRef.current === controller) {
        processingControllerRef.current = null;
        setPhotoBusy(false);
        setPhotoProgress(null);
      }
    }
  }

  function cancelPhotoProcessing() {
    processingControllerRef.current?.abort();
  }

  function removePhoto() {
    setPhoto(null);
    setOriginalPhoto(null);
    setEditorOpen(false);
    setRemoveExistingPhoto(true);
    setError(null);
  }

  function toggleColor(color: string) {
    setForm((current) => ({
      ...current,
      colors: current.colors.includes(color)
        ? current.colors.filter((candidate) => candidate !== color)
        : current.colors.length >= 8
          ? current.colors
          : [...current.colors, color],
    }));
  }

  function addCustomColor() {
    const value = customColor.trim().toLowerCase();
    if (value && !form.colors.includes(value) && form.colors.length < 8) {
      set('colors', [...form.colors, value]);
    }
    setCustomColor('');
    setCustomColorOpen(false);
  }

  function applyCustomCategory() {
    const value = customCategory.trim();
    if (value) set('category', value);
    setCustomCategory('');
    setCustomCategoryOpen(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (photoBusy) return;
    setError(null);

    // Las claves legacy retiradas se omiten: update conserva sus valores y create aplica defaults.
    const input = {
      name: form.name,
      category: form.category,
      colors: form.colors,
      brand: form.brand,
      notes: form.notes,
      archived: garment?.archived ?? false,
      photoId: visiblePhotoId,
    };

    setSaving(true);
    try {
      const pendingPhoto = photo;
      let destination: string;
      if (garment) {
        await updateGarment(garment.id, input);
        destination = `/wardrobe/${garment.id}`;
      } else {
        const created = await createGarment(userId, input);
        destination = navigator.onLine ? `/wardrobe/${created.id}` : '/wardrobe';
      }
      if (pendingPhoto) await queueProcessedImage(pendingPhoto.id, userId);
      router.push(destination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la prenda');
      setSaving(false);
    }
  }

  const determinateProgress =
    photoProgress?.stage === 'Cargando modelo local' &&
    photoProgress.current !== null &&
    photoProgress.total !== null
      ? photoProgress
      : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="-mx-4 md:mx-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoBusy}
            data-testid="photo-upload"
            className="relative flex h-80 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[#F3EFEA] transition-colors hover:bg-border/30 disabled:cursor-wait"
            aria-label={hasPhoto ? 'Cambiar foto de la prenda' : 'Subir foto de la prenda'}
          >
            {hasPhoto ? (
              <>
                {existingPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={existingPhotoUrl}
                    alt="Vista previa de la prenda"
                    className="absolute inset-0 h-full w-full object-contain p-4"
                    data-testid="photo-preview"
                  />
                ) : null}
                <span className="absolute inset-0 bg-black/5 transition-opacity hover:bg-black/10" />
                <span className="absolute bottom-4 left-4 z-10 flex h-10 items-center gap-2 rounded-full bg-white/95 px-4 text-[13px] font-medium text-primary shadow-soft backdrop-blur-md">
                  <CameraIcon size={18} />
                  Cambiar foto
                </span>
              </>
            ) : (
              <span className="flex flex-col items-center justify-center text-text-secondary">
                <CameraIcon size={40} className="mb-3 opacity-50" />
                <span className="text-[15px] font-semibold">Tomar una foto o subirla</span>
                <span className="mt-1 text-xs text-text-muted">JPEG, PNG, WebP, HEIC o AVIF</span>
              </span>
            )}
          </button>
          {hasPhoto && !photoBusy ? (
            <>
              {canEditPhoto ? (
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="absolute right-16 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-text-secondary shadow-soft transition-colors hover:text-primary"
                  aria-label="Editar recorte de la prenda"
                >
                  <PencilIcon size={20} />
                </button>
              ) : null}
            <button
              type="button"
              onClick={removePhoto}
              className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-text-secondary shadow-soft transition-colors hover:text-danger"
              aria-label="Quitar foto de la prenda"
            >
              <TrashIcon size={20} />
            </button>
            </>
          ) : null}
          {photoBusy ? (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/95 px-6 text-center" aria-live="polite">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
              <p className="text-sm font-semibold">{photoProgress?.stage ?? 'Procesando foto'}</p>
              {determinateProgress ? (
                <progress
                  className="h-2 w-full max-w-xs accent-primary"
                  value={determinateProgress.current ?? 0}
                  max={determinateProgress.total ?? 1}
                  aria-label="Progreso de descarga del modelo"
                />
              ) : (
                <p className="text-xs text-text-muted">Este paso puede tardar varios minutos.</p>
              )}
              <Button type="button" variant="secondary" onClick={cancelPhotoProcessing}>
                Cancelar
              </Button>
            </div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
          className="hidden"
          onChange={handleFile}
          aria-label="Subir foto de la prenda"
        />
      </div>

      {editorOpen && photo?.blob && originalPhoto && removeBackground ? (
        <ImageEditor
          imageId={photo.id}
          resultBlob={photo.blob}
          originalBlob={originalPhoto}
          width={photo.width ?? 1}
          height={photo.height ?? 1}
          onCommit={async (update: ImageEditorUpdate) => {
            const updated = await replaceLocalImageBlob(photo.id, update.blob, update.width, update.height);
            setPhoto(updated);
          }}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}

      <div className="rounded-2xl border border-border bg-surface-alt p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={removeBackground}
            onChange={(event) => setRemoveBackground(event.target.checked)}
            disabled={photoBusy}
            className="mt-1 h-5 w-5 accent-primary"
          />
          <span>
            <span className="block text-sm font-semibold text-text-primary">Quitar el fondo automáticamente</span>
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">
              Se ejecuta solo en este dispositivo. La primera vez descarga cerca de 210 MB; tu foto nunca se envía a IMG.LY ni a otro servicio.
            </span>
          </span>
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">Categoría</p>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {GARMENT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              active={form.category === category}
              onClick={() => set('category', category)}
              className={form.category === category ? '!border-primary !bg-primary !text-white' : '!border-transparent !bg-surface-alt font-semibold'}
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
          {isCustomCategory && form.category ? (
            <Chip active className="!border-primary !bg-primary !text-white">{form.category}</Chip>
          ) : null}
          <Chip onClick={() => setCustomCategoryOpen((open) => !open)} title="Añadir categoría personalizada">
            <PlusIcon size={16} /> Otra
          </Chip>
        </div>
        {customCategoryOpen ? (
          <div className="mt-3 flex gap-2">
            <TextInput
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
              placeholder="Categoría personalizada"
              maxLength={40}
              aria-label="Categoría personalizada"
            />
            <Button type="button" variant="secondary" onClick={applyCustomCategory}>Añadir</Button>
          </div>
        ) : null}
      </div>

      <Field label="Nombre">
        <TextInput
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          placeholder="Blazer de lino"
          maxLength={80}
        />
      </Field>

      <Field label="Marca">
        <TextInput
          value={form.brand}
          onChange={(event) => set('brand', event.target.value)}
          placeholder="Por ejemplo, Zara"
          maxLength={60}
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">Colores</p>
        <div className="flex flex-wrap items-center gap-2.5">
          {GARMENT_COLORS.map((color) => {
            const active = form.colors.includes(color.key);
            return (
              <button
                key={color.key}
                type="button"
                onClick={() => toggleColor(color.key)}
                className={`relative flex h-11 w-11 items-center justify-center rounded-full border transition-all ${active ? 'scale-110 border-primary ring-2 ring-primary/20' : 'border-border/50 hover:scale-105'}`}
                style={{ backgroundColor: color.hex }}
                aria-label={`${active ? 'Quitar' : 'Añadir'} color ${color.label}`}
                aria-pressed={active}
              >
                {active ? <CheckIcon size={20} className={color.key === 'white' ? 'text-black' : 'text-white'} /> : null}
              </button>
            );
          })}
          {form.colors
            .filter((color) => !GARMENT_COLORS.some((defined) => defined.key === color))
            .map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => toggleColor(color)}
                className="flex h-11 min-w-11 items-center justify-center rounded-full border border-primary bg-primary px-3 text-xs text-white ring-2 ring-primary/20"
                aria-label={`Quitar color ${color}`}
                aria-pressed="true"
              >
                {color}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setCustomColorOpen((open) => !open)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-text-muted text-text-muted transition-colors hover:border-primary hover:text-primary"
            aria-label="Añadir color personalizado"
            aria-expanded={customColorOpen}
          >
            <PlusIcon size={20} />
          </button>
        </div>
        {customColorOpen ? (
          <div className="mt-3 flex gap-2">
            <TextInput
              value={customColor}
              onChange={(event) => setCustomColor(event.target.value)}
              placeholder="Color personalizado"
              maxLength={30}
              aria-label="Color personalizado"
            />
            <Button type="button" variant="secondary" onClick={addCustomColor}>Añadir</Button>
          </div>
        ) : null}
      </div>

      <Field label="Notas (opcional)">
        <TextArea
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder="Cuidados especiales, recuerdos u otros detalles"
          maxLength={2000}
        />
      </Field>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="pt-2">
        <Button
          type="submit"
          size="lg"
          className="w-full text-base font-semibold"
          loading={saving}
          disabled={!form.category || photoBusy}
          data-testid="save-garment"
        >
          {garment ? 'Guardar cambios' : 'Guardar prenda'}
        </Button>
      </div>
    </form>
  );
}
