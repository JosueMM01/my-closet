# Preparación de servicios externos

La aplicación funciona con `DATABASE_PROVIDER=sqlite`, `IMAGE_PROVIDER=local`,
`GOOGLE_AUTH_ENABLED=false` y `EMAIL_PROVIDER=disabled`. Esos son los valores
predeterminados. Ninguna credencial aislada activa una conexión externa.

## Estado real

| Servicio | Preparado hoy | Pendiente antes de activar |
|---|---|---|
| Neon | runtime postgres.js, migración base completa, repositorios y contratos en rama staging | soak de staging, concurrencia ampliada y configuración de Vercel |
| Cloudinary | subida firmada navegador→CDN, `finalize`, persistencia y pull de metadatos | convivencia histórica/dos dispositivos y garbage collection |
| Google | start/callback, state, PKCE, nonce, JOSE y vinculación explícita | registrar credenciales/callback y activar solo si se desea |
| Correo SMTP | `disabled`/`capture`/`smtp`, invitaciones y recuperación | configurar y operar entrega de bajo volumen; verificar cambios de correo aparte |
| Vercel | build Next.js reproducible | adaptar límites de assets/modelo, Neon, Cloudinary y rate limit distribuido |
| Respaldos | workflow externo cifrado, política de 8 días, retención 2 y restauración temporal | cargar Secrets/Variables de Actions y ejecutar el primer ensayo completo |

Los proveedores siguen siendo opt-in. Sin selectores explícitos la aplicación
usa SQLite, almacenamiento local y no realiza llamadas a Google.

## Variables

```dotenv
DATABASE_PROVIDER=sqlite
DATABASE_URL=
DATABASE_URL_UNPOOLED=

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

El runtime PostgreSQL usa `postgres.js` y Drizzle. Configurar la URL pooled en
`DATABASE_URL` para la aplicación y la URL directa en
`DATABASE_URL_UNPOOLED` para migraciones. Antes de producción:

1. Crear una rama Neon de staging y aplicar `pnpm db:migrate` allí.
2. Ejecutar `tests/integration/postgres-contract.test.ts` contra esa rama.
3. Probar concurrencia, sync y recuperación con datos representativos.
4. Promover la misma migración revisada; nunca experimentar en la rama raíz.

## Cloudinary

Con `IMAGE_PROVIDER=cloudinary`, el navegador obtiene una firma autenticada,
sube el WebP directamente al CDN y llama a `/api/images/finalize`. El servidor
consulta Cloudinary, valida con Zod formato/dimensiones/tamaño/propietario y
persiste `public_id`, URL y metadatos. `CLOUDINARY_API_SECRET` nunca sale del
servidor. Antes de producción aún se debe probar convivencia histórica en dos
dispositivos e implementar garbage collection con comprobación de referencias.

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
`http://localhost:3001/api/auth/google/callback` para el puerto local actual
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

Bloqueadores explícitos antes de producción: rate limit distribuido,
verificación del nuevo correo, garbage collection seguro de imágenes y soak de
Neon/Cloudinary en staging y dos dispositivos. Además se
requieren `AUTH_SECRET` fuerte, SMTP operativo de bajo volumen para invitaciones
y recuperación, CSP revisada y suite completa en staging. La eliminación de
fondo sirve unos 200 MB de assets y debe evaluarse para el hosting elegido.

Los respaldos no usan variables de Vercel ni las credenciales de Google
Sign-In. Su configuración, primera ejecución y prueba de restauración están en
`docs/BACKUPS.md`.
