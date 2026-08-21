# ADR-003: Cloudinary directo con fallback ImageStorage local

## Status
Accepted · implementado en staging el 2026-08-21

## Context
Las fotos deben acabar en un CDN (Cloudinary) sin pasar por el backend de
Next (instrucción explícita: navegador → firma → Cloudinary directo). En
desarrollo no puede haber cuenta conectada.

## Decision
Abstracción `ImageStorage` en `src/server/images/storage.ts`:
- `LocalImageStorage`: guarda blobs WebP en SQLite y los sirve por
  `/api/images/[id]` (uuid inadivinable, cache inmutable). Activo por defecto.
- `CloudinaryImageStorage`: firma una subida directa y valida después el recurso
  contra la API de Cloudinary antes de persistir propietario, `public_id`, URL,
  dimensiones y proveedor. El backend no recibe ni transforma el binario.
- El flujo local usa `/api/images` (multipart). El flujo Cloudinary usa firma,
  subida directa desde el navegador y `/api/images/finalize`.

El secreto `CLOUDINARY_API_SECRET` nunca sale del servidor.

## Consequences
- Todo el pipeline local continúa funcionando sin cuenta Cloudinary.
- La subida directa y la finalización están conectadas y probadas en staging;
  siguen pendientes las pruebas multidispositivo y la recolección segura de
  imágenes huérfanas.
- Las imágenes ya subidas localmente permanecen en SQLite hasta migración.
