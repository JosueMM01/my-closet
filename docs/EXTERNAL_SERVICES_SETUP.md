# Preparación de servicios externos

La aplicación funciona con `DATABASE_PROVIDER=sqlite`, `IMAGE_PROVIDER=local`
y `GOOGLE_AUTH_ENABLED=false`. Esos son los valores predeterminados. Ninguna
credencial aislada activa una conexión externa.

## Estado real

| Servicio | Preparado hoy | Pendiente antes de activar |
|---|---|---|
| Neon | esquema PostgreSQL y selector validado | migraciones PG, repositorios PG y pruebas de contrato |
| Cloudinary | credenciales agrupadas, firma y abstracción de storage | subida directa, endpoint de finalización y pull de metadatos de imágenes |
| Google | selector, credenciales agrupadas y sesión interna reutilizable | tablas de identidades, start/callback OAuth, state, PKCE, nonce y vinculación de cuentas |
| Vercel | build Next.js reproducible | adaptar límites de assets/modelo, Neon, Cloudinary y rate limit distribuido |

Mientras falte un adaptador, el selector correspondiente debe permanecer local
o desactivado. PostgreSQL falla de forma explícita antes de importar el driver o
abrir una conexión. Google nunca se anuncia en `/api/auth/providers` hasta que
el flujo OAuth esté completo.

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
```

Las credenciales Cloudinary y Google se validan como grupos completos. Tenerlas
presentes no cambia el proveedor si su selector explícito continúa desactivado.

## Neon

Antes de usar `DATABASE_PROVIDER=postgres` se debe:

1. Generar y revisar migraciones desde `src/server/db/schema-pg.ts`.
2. Implementar repositorios PostgreSQL para usuarios, sesiones, sync e imágenes.
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
debe configurar ni activar este proveedor.

## Google Sign-In

Antes de establecer `GOOGLE_AUTH_ENABLED=true` se debe:

1. Añadir una tabla de identidades con clave única `(provider, subject)`.
2. Permitir usuarios sin contraseña o separar credenciales locales.
3. Implementar redirect y callback en el servidor con state, PKCE y nonce.
4. Validar emisor, audiencia, expiración y `email_verified` del ID token.
5. Definir una política explícita para vincular correos ya registrados.
6. Emitir la cookie HttpOnly `mc_session` existente solo después del mapeo.

No se usarán tokens de Google en localStorage, sessionStorage o IndexedDB. El
botón no aparece hasta que todo el flujo esté implementado y probado.

## Producción

Antes de desplegar se requiere `AUTH_SECRET` fuerte, proveedores completos,
migraciones verificadas, CSP revisada, rate limit compartido y la suite completa
en un entorno de staging. La eliminación de fondo sirve unos 200 MB de assets;
debe evaluarse si Vercel puede alojarlos o si se mueven a almacenamiento estático
del mismo origen con sus licencias y checksums preservados.
