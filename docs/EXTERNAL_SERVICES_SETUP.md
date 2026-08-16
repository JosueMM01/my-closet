# EXTERNAL_SERVICES_SETUP — Conexión de servicios externos

Guía exacta para activar, cuando lo decidas, cada servicio preparado.
**Ninguno de estos pasos se ha ejecutado**; la app funciona 100% local sin
ellos.

---

## 1. Neon (PostgreSQL)

### Crear proyecto y connection string
1. Cuenta en https://neon.com → **New Project** (región cercana).
2. Dashboard → **Connection string** → copiar la cadena `postgresql://…`
   (usa la rama `main` y el rol con permisos sobre la BD del proyecto).

### Configurar `DATABASE_URL`
En `.env.local` (dev) o variables de Vercel (prod):
```
DATABASE_URL=postgresql://usuario:contraseña@ep-xxxx-xxxx-0000.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Migraciones
```bash
# 1) generar SQL de migración para el esquema PG (espejo de SQLite):
pnpm db:generate          # drizzle-kit genera ./drizzle/*.sql

# 2) aplicarlas contra Neon:
pnpm db:migrate
```
> `drizzle.config.ts` usa `schema-pg.ts` cuando `DATABASE_URL` empieza por
> `postgres`; con `file:` usa el esquema SQLite.

### Verificar
```bash
node -e "const p=require('postgres');const s=p(process.env.DATABASE_URL);s\`select 1\`.then(r=>{console.log('Neon OK',r);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
```
La app arranca con dialecto PostgreSQL automáticamente (ADR-002) y el sync
empieza a replicar en Neon.

---

## 2. Cloudinary (imágenes)

### Crear cuenta y localizar credenciales
1. Cuenta en https://cloudinary.com (plan free suficiente).
2. Console → **Dashboard**: copiar **Cloud name**, **API key**,
   **API secret**.

### Variables
```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

### Upload con firma (ya implementado)
- Subida **server-side**: `CloudinaryImageStorage` se activa sola al
  detectar las tres variables (`src/server/images/storage.ts`).
- Subida **directa del navegador** (recomendada en producción):
  `GET /api/images/sign` devuelve `{cloudName, apiKey, timestamp,
  signature, folder}`; el navegador hace POST multipart a
  `https://api.cloudinary.com/v1_1/{cloud}/image/upload` con esos campos
  + `file`. La imagen no pasa por el backend. El secreto queda en el
  servidor (ADR-003).

### Verificar
```bash
curl -s http://localhost:3000/api/images/sign -H 'x-requested-with: my-closet' | head -c 200
```
→ JSON con firma (antes devolvía 501 «no configurado»). Al subir una foto
nueva, el registro guardará una URL `res.cloudinary.com`.

---

## 3. Google Sign-In

### Crear credenciales OAuth
1. https://console.cloud.google.com → nuevo proyecto → **APIs & Services →
   OAuth consent screen** (External, nombre de la app, scopes básicos
   `email profile`).
2. **Credentials → Create credentials → OAuth client ID** → tipo
   *Web application*.
3. **Authorized redirect URIs** (ajusta dominio/puerto):
   - Dev: `http://localhost:3000/api/auth/google/callback`
   - Prod: `https://TU-DOMINIO/api/auth/google/callback`
4. Copiar **Client ID** y **Client secret**.

### Variables
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Habilitar el provider
`GET /api/auth/providers` pasa a devolver `google:true` y el botón
«Continuar con Google» aparece en /login (hoy está deshabilitado a propósito).

**Implementación pendiente de conectar** (el diseño lo admite sin romper
nada): ruta `/api/auth/google/start` → redirect a Google; callback
`/api/auth/google/callback` → intercambio del `code` **en el servidor** →
upsert del usuario por email → misma cookie `mc_session` actual. El access
token de Google nunca se expone al navegador (ADR-006).

### Verificar
1. `/login` muestra el botón de Google.
2. Flujo completo → aparece el saludo en el home y la sesión queda en
   cookie HttpOnly (revisar DevTools → Application → Cookies).

---

## 4. Vercel (hosting)

### Importar (cuando decidas publicar)
1. Cuenta Vercel → **Add New → Project** → importar el repositorio de Git
   (el repo local deberá subirse antes a GitHub/GitLab).
2. Framework preset: **Next.js** (detectado; cero config extra).
3. Variables de entorno (Production y Preview):
   `DATABASE_URL` (Neon), `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`,
   y opcionalmente `CLOUDINARY_*` y `GOOGLE_*`.

### Entornos
- **Preview** (cada PR): usa la misma BD Neon de desarrollo si quieres, o
  una rama (branch) de Neon por preview.
- **Production**: rama `main` + BD principal.

### Build
`pnpm build` (ya verificado localmente). Vercel instala con pnpm
automáticamente por el campo `packageManager`.

### Dominio
Project → **Settings → Domains** → añadir dominio y apuntar el DNS según
las instrucciones de Vercel.

### Checklist final antes de producción
- [ ] Migraciones Neon aplicadas (`pnpm db:migrate`).
- [ ] `AUTH_SECRET` fuerte y único.
- [ ] `NEXT_PUBLIC_APP_URL` = dominio final (usado por el chequeo CSRF).
- [ ] Redirect URI de Google actualizado al dominio real.
- [ ] `pnpm e2e` en verde con `DATABASE_URL` de staging.
