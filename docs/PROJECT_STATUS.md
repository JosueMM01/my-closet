# Estado del proyecto

Fecha: 2026-08-20 · Rama base protegida: `main`; integración: `develop`.

## ✅ Completado

| Área | Estado | Evidencia |
|---|---|---|
| Build / TS / Lint | ✅ | `pnpm build`, `pnpm typecheck`, `pnpm lint` en verde |
| Tests unit + integración | ✅ | 86 pruebas Vitest en verde, incluidas cuentas, administración, mail, imágenes y sync |
| Tests E2E | ✅ | 53 Playwright aprobadas, 3 skips intencionales; el modelo real opt-in pasó en Chromium desktop |
| Autenticación local | ✅ | registro/login/logout/sesión con cookie HttpOnly firmada, registro invite-only en producción y bootstrap ADMIN local/test |
| Armario | ✅ | CRUD, archivar, clonar, búsqueda, filtros, categorías/colores personalizados y notas opcionales; talla/condición retiradas de la UI |
| Conjuntos | ✅ | editor por categorías con ciclado, nombre/notas opcionales y fecha programable |
| Calendario | ✅ | mes navegable, día seleccionable, marcar vestido y quitar entradas |
| Sharing | 🟡 | creación, permiso y revocación de enlaces VIEW/MANAGE; la aceptación de la invitación de armario sigue pendiente |
| Perfil y administración | ✅ | nombre, contraseña, correo, foto WebP sin quitar fondo, cuentas, invitaciones y desactivación desde Perfil |
| Imágenes | ✅ | EXIF→resize→WebP y eliminación de fondo ONNX opcional en workers one-shot, assets self-hosted, subida local |
| PWA | ✅ | manifest + iconos + SW (precache shell, estrategias por tipo, actualización controlada, Background Sync) |
| Offline-first | ✅ | IndexedDB fuente de la UI, outbox y reconexión a estado sincronizado |
| Seguridad | ✅ | CSP y cabeceras, rate limit, validación Zod, IDOR protegido, secretos fuera de Git |
| Docs | ✅ | README, AGENTS.md, docs/ completa, 7 ADRs, PRs locales |

## Servicios externos (preparados, NO conectados)

Neon (PostgreSQL) · Cloudinary · Google Sign-In · Vercel tienen configuración
validada y selectores explícitos, pero los adaptadores externos permanecen
desactivados y no se consideran implementados. Ver `docs/EXTERNAL_SERVICES_SETUP.md`.

## Limitaciones conocidas

1. **Fotos en enlaces públicos**: la página pública `/share/...` muestra los
    metadatos; las miniaturas requieren que la imagen del propietario esté
    en el almacenamiento del servidor (sube con el sync online). Cloudinary no
    es una solución disponible aún: permanece desactivado hasta completarse.
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
7. **Cloudinary**: la abstracción existe, pero la subida directa y finalización
   de producción no están completadas; permanece desactivado.
8. **Verificación de correo**: cambiar correo reautentica y rota sesiones, pero
   aún no confirma la propiedad del nuevo buzón.
9. **Rate limiting distribuido**: el limitador actual es en memoria y no sirve
   para múltiples instancias.

## Notas de datos y acceso

- Durante esta funcionalidad se vació intencionalmente la SQLite local. La
  IndexedDB existente no se limpió: es almacenamiento por origen del navegador
  y no se borra con una CLI del proyecto.
- Las invitaciones de cuenta son independientes de los enlaces de compartir
  armario. Las primeras son server-generated, hasheadas, expiran y son de un
  uso; las acciones de administración y correo son solo online.

## Deuda técnica intencional

- `waitForHydration` en E2E usa `networkidle` (determinista en la práctica).
- CSP con `'unsafe-inline'` y `'unsafe-eval'` en script-src: compromisos
  documentados por Next y ONNX Runtime 1.21.
