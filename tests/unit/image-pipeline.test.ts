import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundRemovalAttempts } from '@/lib/images/background-removal';
import {
  PROCESSED_IMAGE_MAX_BYTES,
  validateProcessedImage,
} from '@/lib/images/image-client';
import { computeTargetSize } from '@/lib/images/processor';
import {
  imageProgressSchema,
  imageWorkerMessageSchema,
  imageWorkerRequestSchema,
} from '@/lib/images/worker-protocol';

const webpHeader = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

describe('pipeline de imágenes', () => {
  it('mantiene proporción y nunca amplía imágenes pequeñas', () => {
    expect(computeTargetSize(4000, 2000)).toEqual({ width: 1080, height: 540 });
    expect(computeTargetSize(600, 900)).toEqual({ width: 600, height: 900 });
    expect(computeTargetSize(1000, 3000, 600)).toEqual({ width: 200, height: 600 });
  });

  it('valida MIME real, dimensiones y límite de sincronización', async () => {
    await expect(validateProcessedImage({
      blob: new Blob([webpHeader], { type: 'image/webp' }),
      width: 1080,
      height: 540,
      mimeType: 'image/webp',
    })).resolves.toBeUndefined();

    await expect(validateProcessedImage({
      blob: new Blob([webpHeader], { type: 'image/png' }),
      width: 100,
      height: 100,
      mimeType: 'image/webp',
    })).rejects.toThrow('WebP válida');

    await expect(validateProcessedImage({
      blob: new Blob([webpHeader, new Uint8Array(PROCESSED_IMAGE_MAX_BYTES)], { type: 'image/webp' }),
      width: 100,
      height: 100,
      mimeType: 'image/webp',
    })).rejects.toThrow('3 MB');
  });
});

describe('protocolo del worker', () => {
  it('acepta solicitudes y mensajes tipados', () => {
    const id = crypto.randomUUID();
    expect(imageWorkerRequestSchema.safeParse({
      type: 'process',
      id,
      file: new Blob(['foto'], { type: 'image/jpeg' }),
      operation: { type: 'remove-background', device: 'gpu', model: 'isnet' },
    }).success).toBe(true);
    expect(imageWorkerMessageSchema.safeParse({
      type: 'progress',
      id,
      progress: { stage: 'Descargando modelo local', current: 50, total: 100 },
    }).success).toBe(true);
  });

  it('rechaza progreso ambiguo y payloads desconocidos', () => {
    expect(imageProgressSchema.safeParse({
      stage: 'Descargando modelo local',
      current: 1,
      total: null,
    }).success).toBe(false);
    expect(imageWorkerRequestSchema.safeParse({
      type: 'process',
      id: crypto.randomUUID(),
      file: new Blob(),
      operation: { type: 'resize' },
      externalUrl: 'https://staticimgly.com/model',
    }).success).toBe(false);
  });
});

describe('orquestación de eliminación de fondo', () => {
  it('prioriza WebGPU/full y termina con CPU/fp16', () => {
    expect(backgroundRemovalAttempts(true)).toEqual([
      { type: 'remove-background', device: 'gpu', model: 'isnet' },
      { type: 'remove-background', device: 'cpu', model: 'isnet' },
      { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' },
    ]);
    expect(backgroundRemovalAttempts(false)).toEqual([
      { type: 'remove-background', device: 'cpu', model: 'isnet' },
      { type: 'remove-background', device: 'cpu', model: 'isnet_fp16' },
    ]);
  });
});

describe('manifest generado de IMG.LY', () => {
  it('contiene solo recursos seleccionados y chunks con SHA-256 válido', async () => {
    const script = resolve('scripts/prepare-background-removal-assets.mjs');
    const check = spawnSync(process.execPath, [script, '--check'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('75 chunks');

    const manifestPath = resolve('public/vendor/background-removal/1.7.0/resources.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual([
      '/models/isnet',
      '/models/isnet_fp16',
      '/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
      '/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
      '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
      '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    ]);
  });
});
