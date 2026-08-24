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

export type DetectedImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'heif';

export interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {
  constructor(message = 'El navegador no pudo leer esta imagen') {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/** Detecta el formato por contenido; la extensión y el MIME pueden ser incorrectos en Android. */
export async function detectImageFormat(blob: Blob): Promise<DetectedImageFormat | null> {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brands: string[] = [];
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
      brands.push(ascii(bytes, offset, 4));
    }
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))) {
      return 'heif';
    }
  }
  return null;
}

export function computeTargetSize(
  width: number,
  height: number,
  maxDimension: number = LIMITS.processedImageMaxDimension,
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
  quality: number = LIMITS.processedImageQuality,
): Promise<ProcessedImage> {
  const target = computeTargetSize(sourceWidth, sourceHeight);
  let blob: Blob;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el contexto 2D');
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el contexto 2D');
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('El navegador no pudo codificar WebP')),
        'image/webp',
        quality,
      );
    });
  } else {
    throw new Error('Este navegador no ofrece un canvas compatible');
  }

  return {
    blob,
    width: target.width,
    height: target.height,
    mimeType: 'image/webp',
  };
}

async function decodeWithHtmlImage(file: Blob): Promise<DecodedImage> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new ImageDecodeError();
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new ImageDecodeError();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    throw new ImageDecodeError();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Decodifica corrigiendo orientación EXIF y usa `<img>` como fallback móvil. */
export async function decodeImageFile(
  file: Blob,
): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    return decodeWithHtmlImage(file);
  }
}

export function closeDecodedImage(source: DecodedImage['source']): void {
  if ('close' in source && typeof source.close === 'function') source.close();
}
