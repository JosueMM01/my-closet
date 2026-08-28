import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDB } from '@/lib/local/db';
import { backgroundRemovalAttempts, type BackgroundRemovalCapabilities } from '@/lib/images/background-removal';
import {
  readBackgroundRemovalHistory,
  readLastBackgroundRemovalDiagnostic,
  recordBackgroundRemovalFailure,
  recordBackgroundRemovalSuccess,
  writeBackgroundRemovalDiagnostic,
} from '@/lib/images/background-removal-state';

const FP16 = { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' } as const;
const CAPABILITIES: BackgroundRemovalCapabilities = {
  webGpuAdapter: false,
  isAndroid: true,
  isMobile: true,
  deviceMemoryGb: 8,
  hardwareConcurrency: 8,
  storageHeadroomBytes: 512 * 1024 * 1024,
};

beforeEach(async () => {
  await getDB().kv.clear();
});

describe('memoria adaptativa de eliminación de fondo', () => {
  it('recuerda una ruta exitosa y la retira después de dos fallos', async () => {
    await recordBackgroundRemovalSuccess(FP16);
    expect(await readBackgroundRemovalHistory()).toMatchObject({
      preferred: FP16,
      failures: { 'cpu:isnet_fp16': 0 },
    });

    await recordBackgroundRemovalFailure(FP16);
    await recordBackgroundRemovalFailure(FP16);
    const history = await readBackgroundRemovalHistory();
    expect(history.preferred).toBeNull();
    expect(history.failures['cpu:isnet_fp16']).toBe(2);
    expect(backgroundRemovalAttempts(CAPABILITIES, history)).toEqual([
      { type: 'remove-background', device: 'cpu', model: 'isnet_quint8' },
    ]);
  });

  it('persiste un diagnóstico técnico sin datos de la fotografía o del usuario', async () => {
    const diagnostic = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      capabilities: CAPABILITIES,
      attempts: [{
        attempt: FP16,
        outcome: 'failure' as const,
        code: 'resource-download' as const,
        stage: 'Cargando modelo local' as const,
        durationMs: 1250,
        retries: 1,
        detail: 'Failed to fetch',
      }],
      result: 'manual-original' as const,
      finalMessage: 'Se conservó la fotografía.',
    };

    await writeBackgroundRemovalDiagnostic(diagnostic);
    await expect(readLastBackgroundRemovalDiagnostic()).resolves.toEqual(diagnostic);
    expect(JSON.stringify(diagnostic)).not.toContain('email');
    expect(JSON.stringify(diagnostic)).not.toContain('fileName');
  });
});
