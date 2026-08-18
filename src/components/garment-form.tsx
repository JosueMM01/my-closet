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
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Foto */}
      <div className="-mx-4 md:mx-0">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="photo-upload"
          className="relative flex h-80 w-full flex-col items-center justify-center gap-2 bg-[#F3EFEA] rounded-2xl overflow-hidden transition-colors hover:bg-border/30"
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={existingPhotoUrl}
                  alt="Vista previa"
                  className="absolute inset-0 h-full w-full object-contain p-4"
                  data-testid="photo-preview"
                />
              )}
              <div className="absolute inset-0 bg-black/5 transition-opacity hover:bg-black/10" />
              
              <div className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-text-secondary shadow-soft hover:text-danger z-10 transition-colors" onClick={(e) => { e.stopPropagation(); setPhoto(null); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </div>
              
              <div className="absolute bottom-4 left-4 flex h-10 items-center gap-2 px-4 rounded-full bg-white/95 text-primary font-medium text-[13px] backdrop-blur-md shadow-soft z-10">
                <CameraIcon size={18} />
                Change Photo
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-text-secondary">
              <CameraIcon size={40} className="mb-3 opacity-50" />
              <span className="text-[15px] font-semibold">Take a photo or upload</span>
              <span className="text-xs text-text-muted mt-1">JPEG, PNG or WebP</span>
            </div>
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

      {/* Categoría Pills */}
      <div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {GARMENT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              active={form.category === category}
              onClick={() => set('category', category)}
              className={form.category === category ? '!bg-primary !text-white !border-primary' : '!border-transparent !bg-surface-alt font-semibold'}
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
          {isCustomCategory && form.category && (
            <Chip active className="!bg-primary !text-white !border-primary">{form.category}</Chip>
          )}
        </div>
      </div>

      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Linen Blazer"
          maxLength={80}
        />
      </Field>

      <Field label="Brand">
        <TextInput
          value={form.brand}
          onChange={(e) => set('brand', e.target.value)}
          placeholder="e.g. Zara, H&M"
          maxLength={60}
        />
      </Field>

      <Field label="Color">
        <div className="flex flex-wrap gap-2.5 items-center">
          {GARMENT_COLORS.map((color) => {
            const isActive = form.colors.includes(color.key);
            return (
              <button
                key={color.key}
                type="button"
                onClick={() => toggleColor(color.key)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
                  isActive ? 'border-primary ring-2 ring-primary/20 scale-110' : 'border-border/50 hover:scale-105'
                }`}
                style={{ backgroundColor: color.hex }}
                aria-label={`Color ${color.label}`}
              >
                {isActive && (
                  <CheckIcon size={20} className={color.key === 'white' ? 'text-black' : 'text-white'} />
                )}
              </button>
            );
          })}
          {form.colors
            .filter((c) => !GARMENT_COLORS.some((d) => d.key === c))
            .map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleColor(c)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-primary bg-primary text-white ring-2 ring-primary/20 scale-110"
              >
                <CheckIcon size={20} />
              </button>
            ))}
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-text-muted text-text-muted hover:border-primary hover:text-primary transition-colors">
            <PlusIcon size={20} />
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Size">
          <Select value={form.size} onChange={(e) => set('size', e.target.value)}>
            <option value="">Select size</option>
            {GARMENT_SIZES.map((size) => (
              <option key={size} value={size}>
                {SIZE_LABELS[size]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Condition">
          <Select value={form.dateAcquired} onChange={(e) => set('dateAcquired', e.target.value)}>
             <option value="">Select condition</option>
             <option value="new">New</option>
             <option value="good">Good</option>
             <option value="worn">Worn</option>
          </Select>
        </Field>
      </div>

      <Field label="Notes">
        <TextArea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Any special care instructions or memories..."
          maxLength={2000}
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="pt-2">
        <Button
          type="submit"
          size="lg"
          className="w-full text-base font-semibold"
          loading={saving}
          disabled={!form.category}
          data-testid="save-garment"
        >
          {garment ? 'Save Changes' : 'Save Garment'}
        </Button>
      </div>
    </form>
  );
}
