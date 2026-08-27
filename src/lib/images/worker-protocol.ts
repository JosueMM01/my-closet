import { z } from 'zod';

const blobSchema = z.custom<Blob>(
  (value) => typeof Blob !== 'undefined' && value instanceof Blob,
  'Se esperaba un Blob de imagen',
);

export const imageProgressStageSchema = z.enum([
  'Preparando imagen',
  'Cargando modelo local',
  'Eliminando fondo',
  'Aplicando transparencia',
  'Codificando WebP',
  'Reintentando en modo compatible',
  'Reintentando descarga del modelo',
  'Usando foto sin eliminación automática',
]);

export const imageProgressSchema = z
  .object({
    stage: imageProgressStageSchema,
    current: z.number().nonnegative().nullable(),
    total: z.number().positive().nullable(),
  })
  .strict()
  .refine(
    ({ current, total }) => (current === null && total === null) || (current !== null && total !== null),
    'El progreso debe incluir current y total juntos',
  );

const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('resize') }).strict(),
  z
    .object({
      type: z.literal('remove-background'),
      device: z.enum(['gpu', 'cpu']),
      model: z.enum(['isnet', 'isnet_fp16', 'isnet_quint8']),
    })
    .strict(),
]);

export const imageWorkerRequestSchema = z
  .object({
    type: z.literal('process'),
    id: z.string().uuid(),
    file: blobSchema,
    operation: operationSchema,
  })
  .strict();

const progressMessageSchema = z
  .object({
    type: z.literal('progress'),
    id: z.string().uuid(),
    progress: imageProgressSchema,
  })
  .strict();

const successMessageSchema = z
  .object({
    type: z.literal('success'),
    id: z.string().uuid(),
    blob: blobSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.literal('image/webp'),
  })
  .strict();

const failureMessageSchema = z
  .object({
    type: z.literal('failure'),
    id: z.string().uuid(),
    code: z.enum([
      'decode',
      'processing',
      'resource-download',
      'resource-integrity',
      'memory',
      'inference',
    ]),
    stage: imageProgressStageSchema,
    error: z.string().min(1).max(500),
  })
  .strict();

export const imageWorkerMessageSchema = z.discriminatedUnion('type', [
  progressMessageSchema,
  successMessageSchema,
  failureMessageSchema,
]);

export type ImageProgress = z.infer<typeof imageProgressSchema>;
export type ImageWorkerRequest = z.infer<typeof imageWorkerRequestSchema>;
export type ImageWorkerMessage = z.infer<typeof imageWorkerMessageSchema>;
export type ImageWorkerFailureCode = Extract<ImageWorkerMessage, { type: 'failure' }>['code'];
