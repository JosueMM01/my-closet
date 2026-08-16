/**
 * Lógica de procesamiento de imagen (reutilizable en worker y hilo principal):
 * orientación EXIF → resize → WebP.
 */
import { LIMITS } from '@/lib/domain/constants';

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: 'image/webp';
}

export function computeTargetSize(
  width: number,
  height: number,
  maxDimension = LIMITS.processedImageMaxDimension,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Dibuja el bitmap en un canvas ajustado y lo codifica como WebP.
 * Requiere OffscreenCanvas ( disponible en main thread y workers modernos ).
 */
export async function encodeBitmapToWebp(
  bitmap: ImageBitmap | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  quality = LIMITS.processedImageQuality,
): Promise<ProcessedImage> {
  const target = computeTargetSize(sourceWidth, sourceHeight);
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto 2D');
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  const blob = await canvas.convertToBlob({
    type: 'image/webp',
    quality,
  });
  return {
    blob,
    width: target.width,
    height: target.height,
    mimeType: 'image/webp',
  };
}

/** Decodifica un File/Blob corrigiendo la orientación EXIF. */
export async function decodeImageFile(
  file: Blob,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
