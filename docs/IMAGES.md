# Imágenes

## Pipeline del navegador (activo)

```
imagen original (JPEG/HEIC/PNG/WebP/AVIF, ≤ 15 MB)
  → validar MIME y tamaño          src/lib/images/image-client.ts
  → createImageBitmap (corrige EXIF)
  → Web Worker + OffscreenCanvas   src/lib/images/image-worker.ts
      · resize máx. 1080×1080      LIMITS.processedImageMaxDimension
      · encode WebP calidad 0.82
  → blob persistido en IndexedDB (images), syncStatus 'pending'
  → URL local (object URL cacheada) para la UI
```

Si el Worker no está disponible, el mismo código (`processor.ts`) corre en
el hilo principal. La UI nunca se bloquea por diseño (operaciones asíncronas).

## Subida al backend

- Con conexión, el sync engine sube cada imagen pendiente a
  `POST /api/images` (multipart `id` + WebP ≤ 3 MB ya procesado).
- El servidor usa la abstracción `ImageStorage`:
  - **LocalImageStorage** (hoy): blob en SQLite servido por
    `GET /api/images/[id]` (uuid inadivinable, `cache-control immutable`).
  - **CloudinaryImageStorage** (preparado): activa solo con
    `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`.
- El registro guarda `remoteUrl`; el cliente prefiere el blob local y usa
  `remoteUrl` en dispositivos nuevos (pull).

## Cloudinary (flujo futuro de producción)

```
Navegador → GET /api/images/sign  (firma sha1 folder+timestamp+secret)
          → sube DIRECTO a https://api.cloudinary.com/…/upload
```

La imagen no pasa por el backend. `CLOUDINARY_API_SECRET` permanece en el
servidor (nunca en el cliente). Configuración: ver
docs/EXTERNAL_SERVICES_SETUP.md y ADR-003.

## Eliminación de fondo

Diseñada como paso opcional del mismo worker (modelo ONNX en el cliente,
desactivable con pocos recursos) — no se activó en esta iteración por el
peso del modelo (~40 MB) frente al valor en el flujo principal. La
arquitectura del worker la admite sin cambios de contrato.
