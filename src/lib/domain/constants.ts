/**
 * Constantes de dominio de My Closet.
 * Valores predefinidos heredados conceptualmente de Libre Closet,
 * con etiquetas en español para la UI.
 */

export const GARMENT_CATEGORIES = [
  'accessories',
  'bags',
  'outerwear',
  'dresses',
  'tops',
  'bottoms',
  'footwear',
  'other',
] as const;

export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  accessories: 'Accesorios',
  bags: 'Bolsos',
  outerwear: 'Abrigos',
  dresses: 'Vestidos',
  tops: 'Partes de arriba',
  bottoms: 'Partes de abajo',
  footwear: 'Calzado',
  other: 'Otro',
};

/** Orden de presentación de categorías en el outfit builder. */
export const CATEGORY_ORDER: readonly string[] = GARMENT_CATEGORIES;

export interface ColorDefinition {
  key: string;
  label: string;
  hex: string;
}

export const GARMENT_COLORS: readonly ColorDefinition[] = [
  { key: 'red', label: 'Rojo', hex: '#C0392B' },
  { key: 'pink', label: 'Rosa', hex: '#E91E8C' },
  { key: 'orange', label: 'Naranja', hex: '#E67E22' },
  { key: 'yellow', label: 'Amarillo', hex: '#F1C40F' },
  { key: 'green', label: 'Verde', hex: '#27AE60' },
  { key: 'blue', label: 'Azul', hex: '#2E86C1' },
  { key: 'purple', label: 'Morado', hex: '#8E44AD' },
  { key: 'black', label: 'Negro', hex: '#1C1C1C' },
  { key: 'white', label: 'Blanco', hex: '#FDFDFD' },
  { key: 'grey', label: 'Gris', hex: '#95A5A6' },
  { key: 'beige', label: 'Beige', hex: '#D9C7A7' },
  { key: 'brown', label: 'Marrón', hex: '#7B5E3B' },
  { key: 'gold', label: 'Dorado', hex: '#C9A227' },
  { key: 'silver', label: 'Plateado', hex: '#BDC3C7' },
  { key: 'pattern', label: 'Estampado', hex: '#E8D5F2' },
  { key: 'other', label: 'Otro', hex: '#A79F99' },
];

export const COLOR_KEYS = GARMENT_COLORS.map((c) => c.key);

export const COLOR_LABELS: Record<string, string> = Object.fromEntries(
  GARMENT_COLORS.map((c) => [c.key, c.label]),
);

export const COLOR_HEX: Record<string, string> = Object.fromEntries(
  GARMENT_COLORS.map((c) => [c.key, c.hex]),
);

/** Tallas canónicas en orden. */
export const GARMENT_SIZES = [
  'XX-Small',
  'X-Small',
  'Small',
  'Medium',
  'Large',
  'X-Large',
  'XX-Large',
  '3X-Large',
  '4X-Large',
  '5X-Large',
] as const;

export type GarmentSize = (typeof GARMENT_SIZES)[number];

/** Alias de tallas normalizados al valor canónico. */
const SIZE_ALIASES: Record<string, GarmentSize> = {
  xxs: 'XX-Small',
  xs: 'X-Small',
  s: 'Small',
  m: 'Medium',
  l: 'Large',
  xl: 'X-Large',
  xlarge: 'X-Large',
  xxl: 'XX-Large',
  '2xl': 'XX-Large',
  '2xlarge': 'XX-Large',
  xxxl: '3X-Large',
  '3xl': '3X-Large',
  '3xlarge': '3X-Large',
  '4xl': '4X-Large',
  '4xlarge': '4X-Large',
  '5xl': '5X-Large',
  '5xlarge': '5X-Large',
};

/** Normaliza una talla libre a su forma canónica si existe alias. */
export function normalizeSize(raw: string): string {
  const trimmed = raw.trim();
  const canonical = (GARMENT_SIZES as readonly string[]).find(
    (s) => s.toLowerCase() === trimmed.toLowerCase(),
  );
  if (canonical) return canonical;
  const alias = SIZE_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed;
}

export const SIZE_LABELS: Record<string, string> = {
  'XX-Small': 'XX-S',
  'X-Small': 'XS',
  Small: 'S',
  Medium: 'M',
  Large: 'L',
  'X-Large': 'XL',
  'XX-Large': 'XXL',
  '3X-Large': '3XL',
  '4X-Large': '4XL',
  '5X-Large': '5XL',
};

/** Límites de negocio compartidos por cliente y servidor. */
export const LIMITS = {
  garmentNameMax: 80,
  brandMax: 60,
  notesMax: 2000,
  washingInstructionsMax: 500,
  maxColorsPerGarment: 8,
  maxUploadBytes: 15 * 1024 * 1024, // 15 MB antes de procesar en cliente
  processedImageMaxDimension: 1080,
  processedImageQuality: 0.82,
} as const;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;
