# ADR-003: Cloudinary preparado pero no conectado; ImageStorage local

## Status
Accepted

## Context
Las fotos deben acabar en un CDN (Cloudinary) sin pasar por el backend de
Next (instrucción explícita: navegador → firma → Cloudinary directo). En
desarrollo no puede haber cuenta conectada.

## Decision
Abstracción `ImageStorage` en `src/server/images/storage.ts`:
- `LocalImageStorage`: guarda blobs WebP en SQLite y los sirve por
  `/api/images/[id]` (uuid inadivinable, cache inmutable). Activo por defecto.
- `CloudinaryImageStorage`: abstracción y firma preparada para una subida
  futura. No es un flujo de producción completo y debe permanecer desactivado.
- El flujo local usa `/api/images` (multipart). La subida directa y su
  finalización siguen pendientes antes de usar Cloudinary.

El secreto `CLOUDINARY_API_SECRET` nunca sale del servidor.

## Consequences
- Todo el pipeline de imágenes funciona hoy sin cuenta Cloudinary.
- Las credenciales y el selector no constituyen una activación soportada de
  producción hasta completar la subida directa, finalización y contratos.
- Las imágenes ya subidas localmente permanecen en SQLite hasta migración.
