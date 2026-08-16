# Estado del proyecto

Fecha: 2026-08-16 · Rama base: `development` (promovida a `main` al cierre).

## ✅ Completado

| Área | Estado | Evidencia |
|---|---|---|
| Build / TS / Lint | ✅ | `pnpm build`, `pnpm typecheck`, `pnpm lint` en verde |
| Tests unit + integración | ✅ | 32 tests Vitest (conflictos, validación, repos locales con fake-indexeddb, sync server SQLite, scrypt) |
| Tests E2E | ✅ | 39 Playwright (auth, wardrobe CRUD+filtros, outfits+builder, calendario, offline real, capturas) — 1 skip intencional (variante móvil del spec offline) |
| Autenticación local | ✅ | registro/login/logout/sesión con cookie HttpOnly firmada; offline sin pérdida de datos |
| Wardrobe | ✅ | CRUD completo, archivar, clonar, búsqueda, filtros (categoría/color/talla/marca/archivadas), categorías y colores personalizados |
| Outfits | ✅ | builder por filas de categoría con ciclado ‹ ›, orden, nombre/notas, programar fecha |
| Calendario | ✅ | vista semanal, mini-mes, día seleccionable, marcar vestido, quitar, historial |
| Sharing | ✅ | invitaciones VIEW/MANAGE con token, cambio de permiso, revocación; enlaces públicos por shareableId |
| Perfil | ✅ | datos, estado de sync, sesión expirada, logout sin borrar datos, datos de ejemplo |
| Imágenes | ✅ | pipeline navegador (EXIF→resize→WebP en Worker), subida al backend local, abstracción Cloudinary preparada |
| PWA | ✅ | manifest + iconos + SW (precache shell, estrategias por tipo, actualización controlada, Background Sync) |
| Offline-first | ✅ | IndexedDB fuente de la UI, outbox, reconexión → «Sincronizado» (E2E) |
| Seguridad | ✅ | CSP y cabeceras, rate limit, validación Zod, IDOR protegido, secretos fuera de Git |
| Docs | ✅ | README, AGENTS.md, docs/ completa, 7 ADRs, PRs locales |

## Servicios externos (preparados, NO conectados)

Neon (PostgreSQL) · Cloudinary · Google Sign-In · Vercel → ver
`docs/EXTERNAL_SERVICES_SETUP.md`.

## Limitaciones conocidas

1. **Fotos en enlaces públicos**: la página pública `/share/...` muestra los
   metadatos; las miniaturas requieren que la imagen del propietario esté
   en el almacenamiento del servidor (sube con el sync online). Con
   Cloudinary activo quedará completo.
2. **Rate limiting en memoria**: adecuado a una instancia; en multi-instancia
   mover a almacén compartido (documentado en SECURITY.md).
3. **Repositorio PG espejo**: el esquema PostgreSQL y el dialecto están
   listos, pero los upserts de sync están implementados contra SQLite;
   al conectar Neon se replica el mismo contrato (EXTERNAL_SERVICES_SETUP).
4. **Eliminar fondo** de fotos: opcional y no activado (modelo ONNX pesado);
   el worker lo admite como extensión (ADR-005).
5. **Conflicto por campo**: LWW por entidad (documentado), no merge fino.
6. **Iconos de notificaciones push**: no implementadas (fuera de alcance).

## Deuda técnica intencional

- `waitForHydration` en E2E usa `networkidle` (determinista en la práctica).
- CSP con `'unsafe-inline'` en script-src: compromiso documentado
  (SECURITY.md) por los scripts inline de Next.
