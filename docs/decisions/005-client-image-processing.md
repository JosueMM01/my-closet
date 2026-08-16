# ADR-005: Procesamiento de imágenes en el navegador

## Status
Accepted

## Context
Redimensionar y comprimir fotos en el servidor gastaría cómputo y ancho de
banda; el dispositivo del usuario puede hacerlo perfectamente.

## Decision
Pipeline 100% cliente (`src/lib/images/`):
1. Validación de MIME/tamaño (`LIMITS.maxUploadBytes` = 15 MB).
2. `createImageBitmap(file, { imageOrientation: 'from-image' })` corrige
   orientación EXIF.
3. **Web Worker** (`image-worker.ts`) con OffscreenCanvas: resize a
   máx. 1080px y `convertToBlob('image/webp', quality 0.82)`.
4. El blob WebP se persiste en IndexedDB (`images`) y se marca `pending`
   para subirlo al backend cuando haya conexión.

Fallback: si el Worker u OffscreenCanvas no están disponibles, se procesa
en el hilo principal (mismas funciones puras de `processor.ts`).

## Consequences
- El servidor solo recibe WebP ≤ ~300 KB procesado (límite 3 MB defensivo).
- La UI no se bloquea en dispositivos normales.
- La eliminación de fondo (opcional en el diseño original) queda como
  extensión futura del mismo worker (no se activó por peso del modelo ONNX).
