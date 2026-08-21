# Despliegue (preparado, NO ejecutado)

## Compatibilidad verificada localmente

- `pnpm build` produce una aplicación compatible con Vercel/`next start`
  (build verde en cada integración; ver docs/PROJECT_STATUS.md).
- Rutas dinámicas de API (`runtime='nodejs'`) por better-sqlite3/crypto.
  En Vercel, SQLite de fichero NO persiste entre instancias: para
  producción real usar Neon (ADR-002) y el dialecto PostgreSQL.

## Checklist previo a Vercel

1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` en verde.
2. Migración PostgreSQL aplicada y contratos ejecutados en una rama Neon de
   staging; usar URL pooled en runtime y directa para Drizzle Kit.
3. `AUTH_SECRET` generado (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
4. `NEXT_PUBLIC_APP_URL` con el dominio final.
5. Subida directa Cloudinary probada en staging y en dos dispositivos; revisar
   convivencia histórica y garbage collection antes de producción.
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

El proyecto tiene una rama Neon de staging y Cloudinary conectado para pruebas;
no se ha ejecutado ningún deploy de Vercel. Los bloqueadores explícitos son el
rate limit distribuido, la verificación del cambio de correo, el garbage
collection seguro y las pruebas prolongadas/multidispositivo. También se
debe operar SMTP para invitaciones y recuperación de bajo volumen. Los pasos
exactos están en docs/EXTERNAL_SERVICES_SETUP.md.
