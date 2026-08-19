# Estado del proyecto

Fecha: 2026-08-19 · Rama base protegida: `main`; integración: `develop`.

## ✅ Completado

| Área | Estado | Evidencia |
|---|---|---|
| Build / TS / Lint | ✅ | `pnpm build`, `pnpm typecheck`, `pnpm lint` en verde |
| Tests unit + integración | ✅ | 48 tests Vitest, incluidos pipeline de imágenes, assets IMG.LY, proveedores y aislamiento de outbox |
| Tests E2E | ✅ | 39 Playwright en verde y 3 skips intencionales; el modelo real opt-in pasa aparte en Chromium desktop |
| Autenticación local | ✅ | registro/login/logout/sesión con cookie HttpOnly firmada; offline sin pérdida de datos |
| Armario | ✅ | CRUD, archivar, clonar, búsqueda, filtros, categorías/colores personalizados y notas opcionales; talla/condición retiradas de la UI |
| Conjuntos | ✅ | editor por categorías con ciclado, nombre/notas opcionales y fecha programable |
| Calendario | ✅ | mes navegable, día seleccionable, marcar vestido y quitar entradas |
| Sharing | ✅ | invitaciones VIEW/MANAGE con token, cambio de permiso, revocación; enlaces públicos por shareableId |
| Perfil | ✅ | datos, estado de sync, sesión expirada, logout sin borrar datos, datos de ejemplo |
| Imágenes | ✅ | EXIF→resize→WebP y eliminación de fondo ONNX opcional en workers one-shot, assets self-hosted, subida local |
| PWA | ✅ | manifest + iconos + SW (precache shell, estrategias por tipo, actualización controlada, Background Sync) |
| Offline-first | ✅ | IndexedDB fuente de la UI, outbox, reconexión → «Sincronizado» (E2E) |
| Seguridad | ✅ | CSP y cabeceras, rate limit, validación Zod, IDOR protegido, secretos fuera de Git |
| Docs | ✅ | README, AGENTS.md, docs/ completa, 7 ADRs, PRs locales |

## Servicios externos (preparados, NO conectados)

Neon (PostgreSQL) · Cloudinary · Google Sign-In · Vercel tienen configuración
validada y selectores explícitos, pero los adaptadores externos permanecen
desactivados y no se consideran implementados. Ver `docs/EXTERNAL_SERVICES_SETUP.md`.

## Limitaciones conocidas

1. **Fotos en enlaces públicos**: la página pública `/share/...` muestra los
   metadatos; las miniaturas requieren que la imagen del propietario esté
   en el almacenamiento del servidor (sube con el sync online). Con
   Cloudinary activo quedará completo.
2. **Rate limiting en memoria**: adecuado a una instancia; en multi-instancia
   mover a almacén compartido (documentado en SECURITY.md).
3. **Adaptador PostgreSQL pendiente**: existe el esquema PG, pero repositorios
   y migraciones siguen pendientes. Activarlo falla de forma explícita antes de
   conectar para no simular compatibilidad con Neon.
4. **Eliminar fondo en móviles**: el modelo completo descarga cerca de 200 MB
   y usa cientos de MB de RAM. CPU puede tardar minutos; Mobile Safari no está
   certificado y dispositivos con poca memoria pueden finalizar el worker.
5. **Conflicto por campo**: LWW por entidad (documentado), no merge fino.
6. **Iconos de notificaciones push**: no implementadas (fuera de alcance).

## Deuda técnica intencional

- `waitForHydration` en E2E usa `networkidle` (determinista en la práctica).
- CSP con `'unsafe-inline'` y `'unsafe-eval'` en script-src: compromisos
  documentados por Next y ONNX Runtime 1.21.
