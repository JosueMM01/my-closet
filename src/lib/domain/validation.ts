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
  favorite: z.boolean().optional().default(false),
  photoId: z.optional(z.string().uuid().nullable()).transform((v) => v ?? null),
});

export type GarmentInput = z.output<typeof garmentInputSchema>;
/** Forma aceptada por formularios y repositorios (campos opcionales). */
export type GarmentInputDraft = z.input<typeof garmentInputSchema>;

export const outfitSlotSchema = z.object({
  category: garmentCategorySchema,
  garmentId: z.string().uuid().nullable(),
});

export const outfitInputSchema = z.object({
  name: trimmedMax(LIMITS.garmentNameMax),
  notes: trimmedMax(LIMITS.notesMax),
  slots: z.array(outfitSlotSchema).max(16).default([]),
});

export type OutfitInput = z.output<typeof outfitInputSchema>;
export type OutfitInputDraft = z.input<typeof outfitInputSchema>;

export const calendarEntryInputSchema = z.object({
  date: dateOnly,
  outfitId: z.string().uuid(),
  notes: trimmedMax(LIMITS.notesMax),
  wornAt: z.optional(isoDateTime.nullable().transform((v) => v ?? null)).transform((v) => v ?? null),
});

export type CalendarEntryInput = z.output<typeof calendarEntryInputSchema>;
export type CalendarEntryInputDraft = z.input<typeof calendarEntryInputSchema>;

export const permissionSchema = z.enum(['VIEW', 'MANAGE']);

export const wardrobeShareInputSchema = z.object({
  granteeEmail: z.email('Correo inválido').nullable(),
  permission: permissionSchema,
});

/** Registro / login. */
export const userRoleSchema = z.enum(['USER', 'ADMIN']);
export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

const accountEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Correo inválido').max(120));
const accountPasswordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128);

export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'La invitación no es válida');

const registerBaseSchema = z.object({
  displayName: z.string().trim().min(1, 'El nombre es obligatorio').max(60),
  password: accountPasswordSchema,
});

export const registerSchema = z.union([
  registerBaseSchema.extend({
    email: accountEmailSchema,
    invitationToken: z.undefined().optional(),
  }),
  registerBaseSchema.extend({
    invitationToken: invitationTokenSchema,
    email: z.undefined().optional(),
  }),
]);

export const invitationInspectionRequestSchema = z.object({
  token: invitationTokenSchema,
}).strict();

export const invitationInspectionResponseSchema = z.object({
  email: accountEmailSchema,
  role: userRoleSchema,
  expiresAt: isoDateTime,
  googleAvailable: z.boolean(),
});

export const googleInvitationStartSchema = z.object({
  invitationToken: invitationTokenSchema,
}).strict();

export const loginSchema = z.object({
  email: accountEmailSchema,
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
});

export const forgotPasswordSchema = z.object({
  email: accountEmailSchema,
});

export const passwordResetTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'El enlace de recuperación no es válido');

export const resetPasswordSchema = z.object({
  token: passwordResetTokenSchema,
  newPassword: accountPasswordSchema,
});

export const accountProfileSchema = z.object({
  userId: z.string().uuid(),
  email: accountEmailSchema,
  displayName: z.string().min(1).max(60),
  createdAt: isoDateTime,
  role: userRoleSchema,
  status: userStatusSchema,
  profileImageId: z.string().uuid().nullable(),
});

export const localProfileSchema = accountProfileSchema
  .omit({ status: true })
  .extend({
    role: userRoleSchema.default('USER'),
    profileImageId: z.string().uuid().nullable().default(null),
  });

export const authResponseSchema = z.object({ profile: accountProfileSchema });

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({ authenticated: z.literal(true), profile: accountProfileSchema }),
]);

export const authProvidersResponseSchema = z.object({
  credentials: z.boolean(),
  google: z.boolean(),
  publicRegistration: z.boolean(),
  invitationRegistration: z.literal(true),
});

export const googleLinkStatusResponseSchema = z.discriminatedUnion('linked', [
  z.object({ linked: z.literal(false), providerEmail: z.null() }),
  z.object({ linked: z.literal(true), providerEmail: accountEmailSchema }),
]);

export const googlePictureAvailabilitySchema = z.object({
  available: z.boolean(),
});

export const apiErrorResponseSchema = z.object({ error: z.string().min(1) });
export const operationSuccessResponseSchema = z.object({ ok: z.literal(true) });
export const emailChangeResponseSchema = z.object({ email: accountEmailSchema });

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1, 'El nombre es obligatorio').max(60).optional(),
    profileImageId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.displayName !== undefined || value.profileImageId !== undefined,
    { message: 'Debe indicar al menos un cambio' },
  );

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es obligatoria').max(128),
  newPassword: accountPasswordSchema,
});

export const emailChangeSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es obligatoria').max(128),
  newEmail: accountEmailSchema,
});

export const invitationCreateSchema = z.object({
  email: accountEmailSchema,
  role: userRoleSchema,
  expiresAt: isoDateTime,
});

export const invitationResponseSchema = z.object({
  id: z.string().uuid(),
  email: accountEmailSchema,
  role: userRoleSchema,
  createdBy: z.string().uuid(),
  expiresAt: isoDateTime,
  acceptedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
  acceptedBy: z.string().uuid().nullable(),
  createdAt: isoDateTime,
});

const invitationDeliveryResponseBase = {
  invitation: invitationResponseSchema,
  inviteUrl: z.url(),
};

export const invitationCreatedResponseSchema = z.object({
  ...invitationDeliveryResponseBase,
  delivery: z.enum(['disabled', 'captured', 'sent']),
  token: z.string().min(40).max(64).optional(),
});

export const invitationsResponseSchema = z.object({
  invitations: z.array(invitationResponseSchema),
});

export const adminUserResponseSchema = accountProfileSchema.extend({
  adminSlot: z.union([z.literal(1), z.literal(2)]).nullable(),
});

export const adminUsersResponseSchema = z.object({ users: z.array(adminUserResponseSchema) });

export const adminUserUpdateSchema = z
  .object({
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Debe indicar al menos un cambio',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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

export const syncPullQuerySchema = z
  .object({
    since: isoDateTime.nullable().optional(),
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict()
  .refine((value) => !(value.since && value.cursor), {
    message: 'No se puede combinar since y cursor',
  });

const syncPullPositionSchema = z.object({
  at: isoDateTime,
  id: z.string().min(1).max(64),
}).strict();

const syncPullEntityCursorSchema = z.object({
  done: z.boolean(),
  position: syncPullPositionSchema.nullable(),
}).strict();

export const syncPullCursorPayloadSchema = z.object({
  since: isoDateTime.nullable(),
  upperBound: isoDateTime,
  entities: z.object({
    images: syncPullEntityCursorSchema,
    garments: syncPullEntityCursorSchema,
    outfits: syncPullEntityCursorSchema,
    calendarEntries: syncPullEntityCursorSchema,
    wardrobeShares: syncPullEntityCursorSchema,
  }).strict(),
}).strict();

export type SyncPullCursorPayload = z.infer<typeof syncPullCursorPayloadSchema>;

export const imageStorageProviderSchema = z.enum(['local', 'cloudinary']);

/** Metadatos replicables de imagen; nunca incluye el binario del servidor. */
export const remoteImageMetadataSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  mimeType: z.literal('image/webp'),
  width: z.number().int().positive().max(LIMITS.processedImageMaxDimension).nullable(),
  height: z.number().int().positive().max(LIMITS.processedImageMaxDimension).nullable(),
  byteSize: z.number().int().positive().max(3 * 1024 * 1024),
  remoteUrl: z.union([z.string().startsWith('/api/images/'), z.url()]),
  storageProvider: imageStorageProviderSchema,
  storageKey: z.string().min(1).nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
}).strict();

export type RemoteImageMetadata = z.infer<typeof remoteImageMetadataSchema>;

/** Campos multipart de una imagen ya procesada por el navegador. */
export const processedImageUploadSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.literal('image/webp'),
  width: z.coerce.number().int().positive().max(LIMITS.processedImageMaxDimension),
  height: z.coerce.number().int().positive().max(LIMITS.processedImageMaxDimension),
  byteSize: z.number().int().positive().max(3 * 1024 * 1024),
});

export const imageUploadResponseSchema = z.object({
  image: remoteImageMetadataSchema,
});

export const cloudinaryUploadSignatureSchema = z.object({
  cloudName: z.string().min(1),
  apiKey: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{40}$/),
  folder: z.string().min(1),
  publicId: z.string().uuid(),
}).strict();

export const cloudinaryFinalizeRequestSchema = z.object({
  id: z.string().uuid(),
}).strict();

/** Respuesta mínima validada de Cloudinary Admin API al finalizar. */
export const cloudinaryResourceSchema = z.object({
  public_id: z.string().min(1),
  secure_url: z.url(),
  resource_type: z.literal('image'),
  format: z.literal('webp'),
  bytes: z.number().int().positive().max(3 * 1024 * 1024),
  width: z.number().int().positive().max(LIMITS.processedImageMaxDimension),
  height: z.number().int().positive().max(LIMITS.processedImageMaxDimension),
}).passthrough();

// ---------------------------------------------------------------------------
// Validación de entidades completas (payloads de sync push, lado servidor)
// ---------------------------------------------------------------------------

const syncFields = {
  id: z.string().uuid(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  deletedAt: isoDateTime.nullable(),
  syncStatus: z.enum(['pending', 'syncing', 'synced', 'failed']),
};

export const garmentEntitySchema = z.object({
  ...syncFields,
  userId: z.string().uuid(),
  shareableId: z.string().uuid(),
  name: z.string().nullable(),
  category: garmentCategorySchema,
  colors: z.array(colorKeySchema).max(LIMITS.maxColorsPerGarment),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  notes: z.string().nullable(),
  washingInstructions: z.string().nullable(),
  dateAcquired: dateOnly.nullable(),
  archived: z.boolean(),
  favorite: z.boolean(),
  photoId: z.string().uuid().nullable(),
});

export const outfitEntitySchema = z.object({
  ...syncFields,
  userId: z.string().uuid(),
  shareableId: z.string().uuid(),
  name: z.string().nullable(),
  notes: z.string().nullable(),
  slots: z.array(outfitSlotSchema).max(16),
});

export const calendarEntryEntitySchema = z.object({
  ...syncFields,
  userId: z.string().uuid(),
  date: dateOnly,
  outfitId: z.string().uuid(),
  wornAt: isoDateTime.nullable(),
  notes: z.string().nullable(),
});

export const wardrobeShareEntitySchema = z.object({
  ...syncFields,
  grantorId: z.string().uuid(),
  granteeId: z.string().uuid().nullable(),
  granteeEmail: z.email().nullable(),
  permission: permissionSchema,
  inviteToken: z.string().min(16).max(64),
  acceptedAt: isoDateTime.nullable(),
});

export const syncPullResponseSchema = z.object({
  serverTime: isoDateTime,
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(4096).nullable(),
  images: z.array(remoteImageMetadataSchema),
  garments: z.array(garmentEntitySchema),
  outfits: z.array(outfitEntitySchema),
  calendarEntries: z.array(calendarEntryEntitySchema),
  wardrobeShares: z.array(wardrobeShareEntitySchema),
}).strict();

export const syncPushResultSchema = z.object({
  operationId: z.string().uuid(),
  status: z.enum(['applied', 'conflict', 'invalid']),
  remote: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const syncPushResponseSchema = z.object({
  results: z.array(syncPushResultSchema).max(100),
  serverTime: isoDateTime,
}).strict();

/** Valida un payload de sync según el tipo de entidad. */
export function validateEntityPayload(
  entityType: 'garment' | 'outfit' | 'calendarEntry' | 'wardrobeShare',
  payload: Record<string, unknown>,
): { ok: true; entity: Record<string, unknown> } | { ok: false } {
  const schema =
    entityType === 'garment'
      ? garmentEntitySchema
      : entityType === 'outfit'
        ? outfitEntitySchema
        : entityType === 'calendarEntry'
          ? calendarEntryEntitySchema
          : wardrobeShareEntitySchema;
  const result = schema.safeParse(payload);
  return result.success ? { ok: true, entity: result.data } : { ok: false };
}
