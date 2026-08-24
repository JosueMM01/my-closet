import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backgroundRemovalAttempts,
  shouldAttemptWebGpu,
} from '@/lib/images/background-removal';
import {
  PROCESSED_IMAGE_MAX_BYTES,
  validateImageContent,
  validateProcessedImage,
} from '@/lib/images/image-client';
import { computeTargetSize, detectImageFormat } from '@/lib/images/processor';
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

  it('detecta el formato por firma y no por extensión', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: 'image/png' });
    const avif = new Blob([new Uint8Array([0, 0, 0, 24]), 'ftyp', 'avif', new Uint8Array(4), 'avif']);

    await expect(detectImageFormat(jpeg)).resolves.toBe('jpeg');
    await expect(detectImageFormat(png)).resolves.toBe('png');
    await expect(detectImageFormat(avif)).resolves.toBe('avif');
    await expect(detectImageFormat(new Blob(['no-es-imagen']))).resolves.toBeNull();
  });

  it('rechaza un archivo nombrado como JPEG cuyo contenido es otro formato', async () => {
    const fakeJpeg = new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], 'foto.jpg', { type: 'image/jpeg' });

    await expect(validateImageContent(fakeJpeg)).rejects.toThrow('no coincide');
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
      progress: { stage: 'Cargando modelo local', current: 50, total: 100 },
    }).success).toBe(true);
  });

  it('rechaza progreso ambiguo y payloads desconocidos', () => {
    expect(imageProgressSchema.safeParse({
      stage: 'Cargando modelo local',
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

  it('evita WebGPU en Android por compatibilidad de drivers', () => {
    expect(shouldAttemptWebGpu(true, 'Mozilla/5.0 (Linux; Android 14)')).toBe(false);
    expect(shouldAttemptWebGpu(true, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(true);
    expect(shouldAttemptWebGpu(false, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
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
  }, 120_000);
});
