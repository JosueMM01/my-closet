# Preparación de servicios externos

La aplicación funciona con `DATABASE_PROVIDER=sqlite`, `IMAGE_PROVIDER=local`,
`GOOGLE_AUTH_ENABLED=false` y `EMAIL_PROVIDER=disabled`. Esos son los valores
predeterminados. Ninguna credencial aislada activa una conexión externa.

## Estado real

| Servicio | Preparado hoy | Pendiente antes de activar |
|---|---|---|
| Neon | esquema PG y migraciones de `password_reset_tokens`/`auth_accounts` | runtime, migraciones base completas, repositorios PG y pruebas de contrato |
| Cloudinary | credenciales agrupadas, firma, storage y metadatos en pull | subida directa y endpoint de finalización |
| Google | start/callback, state, PKCE, nonce, JOSE y vinculación explícita | registrar credenciales/callback y activar solo si se desea |
| Correo SMTP | `disabled`/`capture`/`smtp`, invitaciones y recuperación | configurar y operar entrega de bajo volumen; verificar cambios de correo aparte |
| Vercel | build Next.js reproducible | adaptar límites de assets/modelo, Neon, Cloudinary y rate limit distribuido |

Mientras falte un adaptador, el selector correspondiente debe permanecer local
o desactivado. PostgreSQL falla de forma explícita antes de importar el driver o
abrir una conexión. Google sí está implementado, pero no se anuncia ni realiza
llamadas externas mientras su selector esté desactivado.

## Variables

```dotenv
DATABASE_PROVIDER=sqlite
DATABASE_URL=

IMAGE_PROVIDER=local
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

GOOGLE_AUTH_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

AUTH_SECRET=
NEXT_PUBLIC_APP_URL=

# Cerrado en todos los entornos; true solo en E2E explícitos.
PUBLIC_REGISTRATION_ENABLED=false

# Bootstrap inicial: usar ambos juntos una vez y solo en .env.local.
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=

# Correo: por defecto no hay conexiones externas.
EMAIL_PROVIDER=disabled
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
```

Las credenciales Cloudinary y Google se validan como grupos completos. Tenerlas
presentes no cambia el proveedor si su selector explícito continúa desactivado.
La referencia canónica de los nombres y valores predeterminados es
`.env.example`; los valores sensibles se ponen en `.env.local`, nunca en Git.

## Neon

Antes de usar `DATABASE_PROVIDER=postgres` se debe:

1. Completar y revisar las migraciones base desde `src/server/db/schema-pg.ts`.
   Ya existen declaraciones SQLite/PG para `password_reset_tokens` y
   `auth_accounts`, pero dependen del resto del esquema.
2. Implementar repositorios PostgreSQL para usuarios, sesiones, identidades,
   recuperación, sync e imágenes.
3. Ejecutar la misma suite de contratos contra PostgreSQL sin casts a SQLite.
4. Resolver escrituras concurrentes y el watermark consistente del pull.
5. Configurar `DATABASE_URL=postgresql://...` únicamente en el entorno alojado.

El código actual lanza `DatabaseProviderNotImplementedError` deliberadamente.

## Cloudinary

Antes de usar `IMAGE_PROVIDER=cloudinary` se debe:

1. Implementar capability/sign/finalize para subida directa del navegador.
2. Persistir `public_id`, propietario, dimensiones y URL resultante.
3. Incluir metadatos de imágenes en sync pull para dispositivos nuevos.
4. Mantener `/api/images/sign` fuera de Service Worker y cachés compartidas.
5. Probar convivencia con imágenes históricas guardadas en SQLite.

`CLOUDINARY_API_SECRET` siempre permanece en el servidor. Desarrollo local no
debe configurar ni activar este proveedor. El pull ya incluye metadatos de
imágenes y no binarios, pero Cloudinary no está listo para producción: debe
seguir desactivado hasta completar el flujo directo y sus contratos.

## Correo SMTP

Los modos son `disabled` (predeterminado, no envía ni abre red), `capture`
(guarda el mensaje para desarrollo/pruebas) y `smtp` (único modo que abre una
conexión externa). Invitaciones de cuenta y recuperación de contraseña necesitan
`capture` o `smtp` para entregar el enlace. Tests y desarrollo no deben usar
`smtp` por defecto.

Ejemplo exacto para Gmail con App Password, únicamente en un entorno que vaya
a enviar correo:

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM="My Closet <tu-cuenta@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASSWORD=tu-app-password-de-16-caracteres
NEXT_PUBLIC_APP_URL=https://tu-dominio.example
```

`SMTP_PASSWORD` es un secreto de servidor, sin prefijo `NEXT_PUBLIC_`. El uso
previsto de invitaciones y recuperación es de bajo volumen. Una cuenta personal
de Gmail puede servir en ese escenario, pero sus cuotas y fiabilidad no
equivalen a un proveedor transaccional ni garantizan entrega.

## Google Sign-In

Es una integración implementada pero opt-in. En Google Cloud se debe registrar
exactamente esta URI de redirección autorizada:

```text
https://tu-dominio.example/api/auth/google/callback
```

Después se configuran juntos:

```dotenv
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=<client id elegido>
GOOGLE_CLIENT_SECRET=<client secret elegido>
NEXT_PUBLIC_APP_URL=https://tu-dominio.example
```

La URL local equivalente es
`http://localhost:3000/api/auth/google/callback` si se decide probar contra
Google. Nunca se usan credenciales reales en archivos versionados.

Google no registra usuarios ni vincula automáticamente por coincidencia de
correo. Una cuenta con contraseña creada previamente por invitación debe iniciar
sesión y vincular desde Perfil la identidad de Google con el correo verificado
exactamente igual. Solo entonces puede usar el botón del login; una identidad no
vinculada recibe una denegación genérica.

El servidor aplica state, PKCE S256 y nonce, intercambia el código y verifica el
ID token con JOSE/JWKS (RS256, emisor, audiencia, expiración,
`email_verified=true` y nonce). No persiste access/refresh/ID tokens; emite la
cookie interna existente. Con `GOOGLE_AUTH_ENABLED=false` no muestra controles,
no llama a Google y no descarga JWKS.

## Producción

Bloqueadores explícitos antes de producción: repositorios runtime y migraciones
completas de Neon PostgreSQL, subida directa/finalización Cloudinary, rate limit
distribuido y verificación del nuevo correo al cambiarlo desde Perfil. Además se
requieren `AUTH_SECRET` fuerte, SMTP operativo de bajo volumen para invitaciones
y recuperación, CSP revisada y suite completa en staging. La eliminación de
fondo sirve unos 200 MB de assets y debe evaluarse para el hosting elegido.
