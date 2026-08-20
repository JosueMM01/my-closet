# Despliegue (preparado, NO ejecutado)

## Compatibilidad verificada localmente

- `pnpm build` produce una aplicación compatible con Vercel/`next start`
  (build verde en cada integración; ver docs/PROJECT_STATUS.md).
- Rutas dinámicas de API (`runtime='nodejs'`) por better-sqlite3/crypto.
  En Vercel, SQLite de fichero NO persiste entre instancias: para
  producción real usar Neon (ADR-002) y el dialecto PostgreSQL.

## Checklist previo a Vercel

1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` en verde.
2. Adaptador Neon PostgreSQL y migraciones aplicadas y probadas; hoy es un
   bloqueador, no basta con definir `DATABASE_URL`.
3. `AUTH_SECRET` generado (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
4. `NEXT_PUBLIC_APP_URL` con el dominio final.
5. Subida directa Cloudinary implementada, finalizada y probada si habrá fotos
   en producción; hoy Cloudinary es un bloqueador y debe permanecer desactivado.
6. Rate limiting distribuido y verificación de propiedad de correo.
7. `EMAIL_PROVIDER=smtp` solo tras configurar un proveedor de producción y sus
   secretos server-only; `disabled` sigue siendo seguro por defecto.
8. Registro público cerrado, salvo decisión explícita mediante
   `PUBLIC_REGISTRATION_ENABLED=true`.
9. `git status` limpio; historia en `main` estable.

## En Vercel

- Importar el repositorio cuando se decida publicar.
- Framework preset: Next.js (sin configuración extra).
- Variables de entorno (Production/Preview): las del checklist.
- El Service Worker y el manifest se sirven desde `/public` sin cambios.

## Nota

Este proyecto se construyó **completamente local**; no se ha conectado
ninguna cuenta ni ejecutado ningún deploy. Neon, Cloudinary, rate limiting
distribuido y verificación de correo son bloqueadores explícitos de producción.
Los pasos exactos están en docs/EXTERNAL_SERVICES_SETUP.md.
