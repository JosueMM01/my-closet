import { z } from 'zod';
import { getDB } from '@/lib/local/db';
import {
  EMPTY_BACKGROUND_REMOVAL_HISTORY,
  backgroundRemovalAttemptKey,
  type BackgroundRemovalAttempt,
  type BackgroundRemovalCapabilities,
  type BackgroundRemovalHistory,
} from './background-removal';
import { imageProgressStageSchema } from './worker-protocol';

const HISTORY_KEY = 'background-removal:strategy:adaptive-v1';
const DIAGNOSTIC_KEY = 'background-removal:last-diagnostic:adaptive-v1';

const attemptSchema = z.object({
  type: z.literal('remove-background'),
  device: z.enum(['gpu', 'cpu']),
  model: z.enum(['isnet', 'isnet_fp16', 'isnet_quint8']),
}).strict();

const historySchema = z.object({
  preferred: attemptSchema.nullable(),
  failures: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

const capabilitiesSchema = z.object({
  webGpuAdapter: z.boolean(),
  isAndroid: z.boolean(),
  isMobile: z.boolean(),
  deviceMemoryGb: z.number().positive().nullable(),
  hardwareConcurrency: z.number().int().positive(),
  storageHeadroomBytes: z.number().nonnegative().nullable(),
}).strict();

const diagnosticAttemptSchema = z.object({
  attempt: attemptSchema,
  outcome: z.enum(['success', 'failure']),
  code: z.enum([
    'decode',
    'processing',
    'resource-download',
    'resource-integrity',
    'memory',
    'inference',
    'worker',
  ]).nullable(),
  stage: imageProgressStageSchema,
  durationMs: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  detail: z.string().max(300).nullable(),
}).strict();

export const backgroundRemovalDiagnosticSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  capabilities: capabilitiesSchema,
  attempts: z.array(diagnosticAttemptSchema).max(12),
  result: z.enum(['automatic', 'manual-original', 'failed']),
  finalMessage: z.string().max(500).nullable(),
}).strict();

export type BackgroundRemovalDiagnostic = z.infer<typeof backgroundRemovalDiagnosticSchema>;
export type BackgroundRemovalAttemptDiagnostic = z.infer<typeof diagnosticAttemptSchema>;

export async function readBackgroundRemovalHistory(): Promise<BackgroundRemovalHistory> {
  const stored = await getDB().kv.get(HISTORY_KEY);
  const parsed = historySchema.safeParse(stored?.value);
  return parsed.success ? parsed.data : EMPTY_BACKGROUND_REMOVAL_HISTORY;
}

export async function recordBackgroundRemovalSuccess(
  attempt: BackgroundRemovalAttempt,
): Promise<void> {
  const history = await readBackgroundRemovalHistory();
  const key = backgroundRemovalAttemptKey(attempt);
  await getDB().kv.put({
    key: HISTORY_KEY,
    value: historySchema.parse({
      preferred: attempt,
      failures: { ...history.failures, [key]: 0 },
    }),
  });
}

export async function recordBackgroundRemovalFailure(
  attempt: BackgroundRemovalAttempt,
): Promise<void> {
  const history = await readBackgroundRemovalHistory();
  const key = backgroundRemovalAttemptKey(attempt);
  await getDB().kv.put({
    key: HISTORY_KEY,
    value: historySchema.parse({
      preferred:
        history.preferred && backgroundRemovalAttemptKey(history.preferred) === key
          ? null
          : history.preferred,
      failures: { ...history.failures, [key]: (history.failures[key] ?? 0) + 1 },
    }),
  });
}

export async function writeBackgroundRemovalDiagnostic(
  diagnostic: BackgroundRemovalDiagnostic,
): Promise<void> {
  const validated = backgroundRemovalDiagnosticSchema.parse(diagnostic);
  await getDB().kv.put({ key: DIAGNOSTIC_KEY, value: validated });
  console.info('[My Closet][background-removal]', validated);
}

export async function readLastBackgroundRemovalDiagnostic(): Promise<BackgroundRemovalDiagnostic | null> {
  const stored = await getDB().kv.get(DIAGNOSTIC_KEY);
  const parsed = backgroundRemovalDiagnosticSchema.safeParse(stored?.value);
  return parsed.success ? parsed.data : null;
}

export function capabilitySnapshot(value: BackgroundRemovalCapabilities): BackgroundRemovalCapabilities {
  return capabilitiesSchema.parse(value);
}
