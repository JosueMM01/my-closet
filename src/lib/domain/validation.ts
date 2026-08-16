/**
 * Esquemas Zod compartidos: validación de inputs en cliente y servidor.
 */
import { z } from 'zod';
import { LIMITS } from './constants';

const isoDateTime = z.string().datetime({ offset: true });

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

/**
 * Campo de texto opcional: acepta clave ausente, undefined, null o string;
 * siempre produce `string | null` recortado, o null si queda vacío.
 * (El wrapper `z.optional` es necesario en Zod 4 para claves ausentes.)
 */
const trimmedMax = (max: number) =>
  z
    .optional(
      z
        .union([z.string(), z.null()])
        .refine((v) => typeof v !== 'string' || v.length <= max, {
          message: `Máximo ${max} caracteres`,
        })
        .transform((v) => {
          if (typeof v !== 'string') return null;
          const trimmed = v.trim();
          return trimmed.length === 0 ? null : trimmed;
        }),
    )
    .transform((v) => v ?? null);

export const garmentCategorySchema = z
  .string()
  .trim()
  .min(1, 'La categoría es obligatoria')
  .max(40);

export const colorKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((v) => v.toLowerCase());

export const sizeSchema = z.string().trim().min(1).max(20);

/** Datos editables de una prenda (sin campos de sincronización). */
export const garmentInputSchema = z.object({
  name: trimmedMax(LIMITS.garmentNameMax),
  category: garmentCategorySchema,
  colors: z.array(colorKeySchema).max(LIMITS.maxColorsPerGarment).default([]),
  brand: trimmedMax(LIMITS.brandMax),
  size: z.optional(sizeSchema.nullish().transform((v) => (v == null ? null : v.trim()))).transform((v) => v ?? null),
  notes: trimmedMax(LIMITS.notesMax),
  washingInstructions: trimmedMax(LIMITS.washingInstructionsMax),
  dateAcquired: z.optional(dateOnly.nullable().transform((v) => v ?? null)).transform((v) => v ?? null),
  archived: z.boolean().optional().default(false),
  photoId: z.optional(z.string().uuid().nullable()).transform((v) => v ?? null),
});

export type GarmentInput = z.infer<typeof garmentInputSchema>;

export const outfitSlotSchema = z.object({
  category: garmentCategorySchema,
  garmentId: z.string().uuid().nullable(),
});

export const outfitInputSchema = z.object({
  name: trimmedMax(LIMITS.garmentNameMax),
  notes: trimmedMax(LIMITS.notesMax),
  slots: z.array(outfitSlotSchema).max(16).default([]),
});

export type OutfitInput = z.infer<typeof outfitInputSchema>;

export const calendarEntryInputSchema = z.object({
  date: dateOnly,
  outfitId: z.string().uuid(),
  notes: trimmedMax(LIMITS.notesMax),
  wornAt: z.optional(isoDateTime.nullable().transform((v) => v ?? null)).transform((v) => v ?? null),
});

export type CalendarEntryInput = z.infer<typeof calendarEntryInputSchema>;

export const permissionSchema = z.enum(['VIEW', 'MANAGE']);

export const wardrobeShareInputSchema = z.object({
  granteeEmail: z.email('Correo inválido').nullable(),
  permission: permissionSchema,
});

/** Registro / login. */
export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'El nombre es obligatorio').max(60),
  email: z.email('Correo inválido').max(120),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128),
});

export const loginSchema = z.object({
  email: z.email('Correo inválido').max(120),
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Payload de la API de sincronización. */
export const syncPushOperationSchema = z.object({
  operationId: z.string().uuid(),
  entityType: z.enum(['garment', 'outfit', 'calendarEntry', 'wardrobeShare']),
  entityId: z.string().uuid(),
  operation: z.enum(['upsert', 'delete']),
  /** Snapshot de la entidad; el servidor la valida según entityType. */
  payload: z.record(z.string(), z.unknown()),
  clientUpdatedAt: isoDateTime,
  clientVersion: z.number().int().min(1),
});

export const syncPushSchema = z.object({
  operations: z.array(syncPushOperationSchema).min(1).max(100),
});

export const syncPullSchema = z.object({
  since: isoDateTime.nullable(),
  entityType: z.enum(['garment', 'outfit', 'calendarEntry', 'wardrobeShare']).optional(),
});
