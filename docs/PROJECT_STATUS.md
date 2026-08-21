# Estado del proyecto

Fecha: 2026-08-21 · Rama actual: `codex/feat-neon-cloudinary-staging`.

## ✅ Completado

| Área | Estado | Evidencia |
|---|---|---|
| Build / TS / Lint | ✅ | `pnpm build`, `pnpm typecheck`, `pnpm lint` en verde |
| Tests unit + integración | ✅ | 124 pruebas Vitest en verde |
| Tests E2E | ✅ | 62 Playwright aprobadas y 4 skips esperados; modelo real opt-in aprobado en Chromium desktop |
| Autenticación local | ✅ | login/logout, alta solo por invitación, bootstrap seguro, recuperación y cookie HttpOnly firmada |
| Google Sign-In | ✅ opt-in | vinculación explícita por correo verificado y login solo de identidad vinculada; desactivado sin red por defecto |
| Armario | ✅ | CRUD, archivar, clonar, búsqueda, filtros, categorías/colores personalizados y notas opcionales; talla/condición retiradas de la UI |
| Conjuntos | ✅ | editor y sugerencias locales deterministas con contexto manual, ranking e historial de IndexedDB |
| Calendario | ✅ | mes navegable, día seleccionable, marcar vestido y quitar entradas |
| Sharing | 🟡 | creación, permiso y revocación de enlaces VIEW/MANAGE; la aceptación de la invitación de armario sigue pendiente |
| Perfil y administración | ✅ | nombre, contraseña, correo, foto WebP sin quitar fondo, cuentas, invitaciones y desactivación desde Perfil |
| Imágenes | ✅ staging | EXIF→resize→WebP, ONNX local y subida directa Cloudinary con finalize verificado |
| PostgreSQL | ✅ staging | runtime postgres.js, migración base, 10 tablas, guardas admin y contratos contra Neon |
| PWA | ✅ | manifest + iconos + SW (precache shell, estrategias por tipo, actualización controlada, Background Sync) |
| Offline-first | ✅ | IndexedDB fuente de la UI, outbox y reconexión a estado sincronizado |
| Seguridad | ✅ | CSP, Zod, IDOR, reset hash-only, OAuth state/PKCE/nonce/JOSE y secretos fuera de Git |
| Docs | ✅ | README, AGENTS.md, docs/ completa, 7 ADRs, PRs locales |

## Servicios externos

Google Sign-In está activo en el entorno de prueba y genera el callback local
correcto. Neon y Cloudinary están conectados a staging y pasaron pruebas de
runtime; siguen siendo opt-in y no se activan con los valores predeterminados.

## Limitaciones conocidas

1. **Fotos en enlaces públicos**: la página pública `/share/...` muestra los
    metadatos; las miniaturas requieren que la imagen del propietario esté
    en el almacenamiento remoto (sube con el sync online). Falta verificar
    clones/referencias y dos dispositivos con imágenes históricas.
2. **Staging PostgreSQL**: runtime y contratos están activos en una rama Neon;
   faltan soak, carga/concurrencia ampliada y promoción controlada.
3. **Eliminar fondo en móviles**: el modelo completo descarga cerca de 200 MB
   y usa cientos de MB de RAM. CPU puede tardar minutos; Mobile Safari no está
   certificado y dispositivos con poca memoria pueden finalizar el worker.
4. **Conflicto por campo**: LWW por entidad (documentado), no merge fino.
5. **Iconos de notificaciones push**: no implementadas (fuera de alcance).
6. **Cloudinary**: subida directa/finalización están completas en staging;
   faltan garbage collection seguro y validación multidispositivo.
7. **Verificación de correo**: cambiar correo reautentica y rota sesiones, pero
   aún no confirma la propiedad del nuevo buzón.
8. **Rate limiting distribuido**: el limitador actual es en memoria y no sirve
   para múltiples instancias.
9. **Entrega de correo**: invitaciones y recuperación requieren SMTP operativo;
   el volumen previsto es bajo y `disabled` no envía nada.

## Notas de datos y acceso

- Durante esta funcionalidad se vació intencionalmente la SQLite local. La
  IndexedDB existente no se limpió: es almacenamiento por origen del navegador
  y no se borra con una CLI del proyecto.
- Las invitaciones de cuenta son independientes de los enlaces de compartir
  armario. Las primeras son server-generated, hasheadas, expiran y son de un
  uso; las acciones de administración y correo son solo online.
- El registro público está cerrado en todos los entornos. El login no enlaza a
  «Crear cuenta» y las altas reales usan fragmentos de invitación.
- El contexto de sugerencias vive por usuario en el KV local y no se sincroniza.
  El motor no usa IA, red ni análisis de fotos.

## Deuda técnica intencional

- `waitForHydration` en E2E usa `networkidle` (determinista en la práctica).
- CSP con `'unsafe-inline'` y `'unsafe-eval'` en script-src: compromisos
  documentados por Next y ONNX Runtime 1.21.
