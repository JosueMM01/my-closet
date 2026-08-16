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
- `CloudinaryImageStorage`: subida firmada (sha1 de `folder+timestamp+secret`
  según especificación de Cloudinary). Se activa solo con las tres variables
  `CLOUDINARY_*` presentes.
- `/api/images/sign` entrega la firma para subida **directa** del navegador
  al CDN; el flujo local usa `/api/images` (multipart).

El secreto `CLOUDINARY_API_SECRET` nunca sale del servidor.

## Consequences
- Todo el pipeline de imágenes funciona hoy sin cuenta Cloudinary.
- Al configurar las variables, las subidas nuevas van al CDN sin cambios de
  código en el cliente (el registro guarda `remoteUrl`).
- Las imágenes ya subidas localmente permanecen en SQLite hasta migración.
