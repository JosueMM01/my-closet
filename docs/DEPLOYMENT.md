# Despliegue (preparado, NO ejecutado)

## Compatibilidad verificada localmente

- `pnpm build` produce una aplicación compatible con Vercel/`next start`
  (build verde en cada integración; ver docs/PROJECT_STATUS.md).
- Rutas dinámicas de API (`runtime='nodejs'`) por better-sqlite3/crypto.
  En Vercel, SQLite de fichero NO persiste entre instancias: para
  producción real usar Neon (ADR-002) y el dialecto PostgreSQL.

## Checklist previo a Vercel

1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` en verde.
2. Repositorios runtime Neon PostgreSQL y migraciones completas aplicadas y
   probadas; las declaraciones PG de auth no bastan para activar el proveedor.
3. `AUTH_SECRET` generado (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
4. `NEXT_PUBLIC_APP_URL` con el dominio final.
5. Subida directa Cloudinary implementada, finalizada y probada si habrá fotos
   en producción; hoy Cloudinary es un bloqueador y debe permanecer desactivado.
6. Rate limiting distribuido y cambio de correo de perfil con verificación de
   propiedad del nuevo buzón.
7. SMTP de bajo volumen configurado para entregar invitaciones y recuperación;
   `disabled` no envía enlaces.
8. Registro público cerrado (`PUBLIC_REGISTRATION_ENABLED=false`). Crear el
   primer administrador con las dos variables bootstrap en un entorno secreto,
   arrancar una vez y retirar inmediatamente ambas, en especial la contraseña.
9. `git status` limpio; historia en `main` estable.

## En Vercel

- Importar el repositorio cuando se decida publicar.
- Framework preset: Next.js (sin configuración extra).
- Variables de entorno (Production/Preview): las del checklist.
- Si se habilita Google, registrar como callback exacto
  `https://<dominio>/api/auth/google/callback` y configurar selector,
  credenciales y `NEXT_PUBLIC_APP_URL` como grupo.
- El Service Worker y el manifest se sirven desde `/public` sin cambios.

## Nota

Este proyecto se construyó **completamente local**; no se ha conectado
ninguna cuenta ni ejecutado ningún deploy. Los bloqueadores explícitos son los
repositorios runtime Neon, la subida directa/finalización Cloudinary, el rate
limit distribuido y la verificación del cambio de correo de perfil. También se
debe operar SMTP para invitaciones y recuperación de bajo volumen. Los pasos
exactos están en docs/EXTERNAL_SERVICES_SETUP.md.
