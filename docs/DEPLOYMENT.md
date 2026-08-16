# Despliegue (preparado, NO ejecutado)

## Compatibilidad verificada localmente

- `pnpm build` produce una aplicación compatible con Vercel/`next start`
  (build verde en cada integración; ver docs/PROJECT_STATUS.md).
- Rutas dinámicas de API (`runtime='nodejs'`) por better-sqlite3/crypto.
  En Vercel, SQLite de fichero NO persiste entre instancias: para
  producción real usar Neon (ADR-002) y el dialecto PostgreSQL.

## Checklist previo a Vercel

1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` en verde.
2. `DATABASE_URL` apuntando a Neon + migraciones aplicadas
   (docs/EXTERNAL_SERVICES_SETUP.md §Neon).
3. `AUTH_SECRET` generado (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
4. `NEXT_PUBLIC_APP_URL` con el dominio final.
5. Variables opcionales de Cloudinary/Google si se desean.
6. `git status` limpio; historia en `main` estable.

## En Vercel

- Importar el repositorio cuando se decida publicar.
- Framework preset: Next.js (sin configuración extra).
- Variables de entorno (Production/Preview): las del checklist.
- El Service Worker y el manifest se sirven desde `/public` sin cambios.

## Nota

Este proyecto se construyó **completamente local**; no se ha conectado
ninguna cuenta ni ejecutado ningún deploy. Los pasos exactos están en
docs/EXTERNAL_SERVICES_SETUP.md.
