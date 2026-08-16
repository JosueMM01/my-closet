'use client';

/**
 * Formulario de prenda (crear/editar). La foto se procesa en el navegador
 * (worker → resize → WebP) antes de persistir en IndexedDB.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  GARMENT_SIZES,
  SIZE_LABELS,
  normalizeSize,
} from '@/lib/domain/constants';
import type { Garment, ImageRecord } from '@/lib/domain/types';
import {
  ImageValidationError,
  saveGarmentPhoto,
} from '@/lib/images/image-client';
import { createGarment, updateGarment } from '@/lib/local/repositories';
import { useImageUrl } from './garment-photo';
import { CameraIcon, CheckIcon, PlusIcon } from './icons';
import { Button, Chip, Field, Select, TextArea, TextInput } from './ui';

interface FormState {
  name: string;
  category: string;
  colors: string[];
  brand: string;
  size: string;
  notes: string;
  washingInstructions: string;
  dateAcquired: string;
}

function toFormState(garment?: Garment): FormState {
  return {
    name: garment?.name ?? '',
    category: garment?.category ?? 'tops',
    colors: garment?.colors ?? [],
    brand: garment?.brand ?? '',
    size: garment?.size ?? '',
    notes: garment?.notes ?? '',
    washingInstructions: garment?.washingInstructions ?? '',
    dateAcquired: garment?.dateAcquired ?? '',
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
  const [form, setForm] = useState<FormState>(() => toFormState(garment));
  const [photo, setPhoto] = useState<ImageRecord | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Custom category/color inputs
  const [customCategory, setCustomCategory] = useState('');
  const [customColor, setCustomColor] = useState('');
  const isCustomCategory = !GARMENT_CATEGORIES.includes(form.category as never);

  const existingPhotoUrl = useImageUrl(photo ? photo.id : (garment?.photoId ?? null));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const record = await saveGarmentPhoto(userId, file);
      setPhoto(record);
    } catch (err) {
      setError(
        err instanceof ImageValidationError
          ? err.message
          : 'No se pudo procesar la imagen. Prueba con otra foto.',
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  function toggleColor(color: string) {
    setForm((current) => ({
      ...current,
      colors: current.colors.includes(color)
        ? current.colors.filter((c) => c !== color)
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
  }

  function applyCustomCategory() {
    const value = customCategory.trim();
    if (value) set('category', value);
    setCustomCategory('');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const input = {
      name: form.name,
      category: form.category,
      colors: form.colors,
      brand: form.brand,
      size: form.size ? normalizeSize(form.size) : null,
      notes: form.notes,
      washingInstructions: form.washingInstructions,
      dateAcquired: form.dateAcquired || null,
      archived: garment?.archived ?? false,
      photoId: photo ? photo.id : (garment?.photoId ?? null),
    };

    setSaving(true);
    try {
      if (garment) {
        await updateGarment(garment.id, input);
        router.push(`/wardrobe/${garment.id}`);
      } else {
        const created = await createGarment(userId, input);
        // Offline: la ruta dinámica de detalle puede no estar en caché del
        // SW; la lista (shell precacheado) siempre está disponible.
        router.push(navigator.onLine ? `/wardrobe/${created.id}` : '/wardrobe');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la prenda');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Foto */}
      <div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="photo-upload"
          className="card-surface flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 border-2 border-dashed! border-border! bg-surface-alt/50 text-text-secondary transition-colors hover:border-primary! hover:text-primary"
        >
          {photoBusy ? (
            <>
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
                role="status"
                aria-label="Procesando foto"
              />
              <span className="text-sm font-medium">Procesando foto…</span>
            </>
          ) : photo || garment?.photoId ? (
            <>
              {existingPhotoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- blob local
                <img
                  src={existingPhotoUrl}
                  alt="Vista previa"
                  className="max-h-56 rounded-xl object-contain"
                  data-testid="photo-preview"
                />
              )}
              <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <CameraIcon size={16} />
                Cambiar foto
              </span>
            </>
          ) : (
            <>
              <CameraIcon size={32} />
              <span className="text-sm font-semibold">Añadir foto</span>
              <span className="text-xs text-text-muted">JPEG, PNG o WebP · hasta 15 MB</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
          className="hidden"
          onChange={handleFile}
          aria-label="Subir foto de la prenda"
        />
      </div>

      <Field label="Nombre">
        <TextInput
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Blusa de lino"
          maxLength={80}
        />
      </Field>

      <Field label="Categoría" error={!form.category ? 'La categoría es obligatoria' : undefined}>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {GARMENT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              active={form.category === category}
              onClick={() => set('category', category)}
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
          {isCustomCategory && form.category && (
            <Chip active>{form.category}</Chip>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <TextInput
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="Categoría personalizada…"
            className="flex-1"
            aria-label="Nueva categoría personalizada"
          />
          <Button type="button" variant="secondary" onClick={applyCustomCategory}>
            <PlusIcon size={16} />
          </Button>
        </div>
      </Field>

      <Field label="Colores" hint="Hasta 8 colores">
        <div className="flex flex-wrap gap-2">
          {GARMENT_COLORS.map((color) => (
            <Chip
              key={color.key}
              active={form.colors.includes(color.key)}
              onClick={() => toggleColor(color.key)}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-border"
                style={{ background: color.hex }}
                aria-hidden
              />
              {color.label}
            </Chip>
          ))}
          {form.colors
            .filter((c) => !GARMENT_COLORS.some((d) => d.key === c))
            .map((c) => (
              <Chip key={c} active onClick={() => toggleColor(c)}>
                {c}
              </Chip>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <TextInput
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            placeholder="Color personalizado…"
            className="flex-1"
            aria-label="Nuevo color personalizado"
          />
          <Button type="button" variant="secondary" onClick={addCustomColor}>
            <PlusIcon size={16} />
          </Button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Marca">
          <TextInput
            value={form.brand}
            onChange={(e) => set('brand', e.target.value)}
            placeholder="Zara"
            maxLength={60}
          />
        </Field>
        <Field label="Talla">
          <Select value={form.size} onChange={(e) => set('size', e.target.value)}>
            <option value="">—</option>
            {GARMENT_SIZES.map((size) => (
              <option key={size} value={size}>
                {SIZE_LABELS[size]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Fecha de adquisición">
          <TextInput
            type="date"
            value={form.dateAcquired}
            onChange={(e) => set('dateAcquired', e.target.value)}
          />
        </Field>
        <Field label="Cuidados">
          <TextInput
            value={form.washingInstructions}
            onChange={(e) => set('washingInstructions', e.target.value)}
            placeholder="Lavar en frío"
            maxLength={500}
          />
        </Field>
      </div>

      <Field label="Notas">
        <TextArea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Detalles, historia de la prenda…"
          maxLength={2000}
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
          onClick={() => router.back()}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          className="flex-1"
          loading={saving}
          disabled={!form.category}
          data-testid="save-garment"
        >
          <CheckIcon size={18} />
          {garment ? 'Guardar cambios' : 'Guardar prenda'}
        </Button>
      </div>
    </form>
  );
}
