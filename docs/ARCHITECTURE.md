# Arquitectura de My Closet

My Closet es una PWA con Next.js App Router. La experiencia del armario usa
IndexedDB como fuente de lectura y conserva las escrituras offline mediante
una outbox. Las API del servidor validan identidad, permisos y datos antes
de persistir en PostgreSQL o SQLite.

## Capas

| Capa | Ruta | Responsabilidad |
|---|---|---|
| Dominio | `src/lib/domain/` | Tipos, Zod, fechas, identificadores, conflictos y sugerencias puras |
| Almacenamiento local | `src/lib/local/` | Dexie, repositorios, outbox, sincronización y caché por usuario |
| Imágenes cliente | `src/lib/images/` | Validación, orientación, tamaño, WebP y eliminación de fondo en worker |
| Identidad cliente | `src/lib/auth/`, `src/lib/account/`, `src/lib/admin/` | Acceso, invitaciones, recuperación, perfil local y administración |
| Servidor | `src/server/` | Configuración, Drizzle, sesiones, OAuth, correo, límites y almacenamiento de imágenes |
| API | `src/app/api/` | Boundaries de autenticación, perfil, administración, sync, imágenes y enlaces públicos |
| Interfaz | `src/app/(app)/`, `src/app/(auth)/`, `src/app/share/` | Páginas, componentes y shell offline |

## Escrituras y sincronización

1. La acción se valida y el repositorio ejecuta una transacción Dexie: guarda
   la entidad versionada y su operación en la outbox.
2. `useLiveQuery` refleja el resultado local sin esperar una petición.
3. El motor envía lotes a `POST /api/sync/push` y sincroniza imágenes pendientes.
4. En modo local, las imágenes van a `POST /api/images`. Con Cloudinary,
   el navegador obtiene la firma, sube directamente y finaliza por API.
5. El pull incremental obtiene cambios y metadatos para actualizar IndexedDB.

Los disparadores incluyen cambios locales, recuperación de conectividad y
apertura o reanudación de la aplicación. Los conflictos se resuelven por entidad
con last-writer-wins; no hay CRDT ni fusión por campo. Los tombstones permiten
propagar borrados.

## Lectura y sesión

La UI privada del armario lee IndexedDB; el motor de sync consulta el servidor.
La comprobación de sesión y las operaciones de identidad y administración
requieren red. La caché administrativa conserva un read model, nunca autoridad
para decidir permisos.

La sesión remota usa cookies HttpOnly. No se guardan tokens de sesión en
localStorage, sessionStorage ni IndexedDB. Una sesión remota expirada exige
reautenticación y preserva la identidad local y la outbox. El trabajo offline
permanece ligado al origen del navegador y al usuario correspondiente.

El cambio de correo exige contraseña actual y un código numérico de 6 dígitos
enviado al nuevo buzón, con caducidad de 10 minutos y HMAC-SHA256 con el secreto
del servidor. Cinco intentos fallidos invalidan el código. La confirmación está
ligada a la cuenta, correo y huella de las credenciales originales; solo la
última solicitud es válida. Una transacción cambia el correo e invalida el
código, las sesiones y los enlaces de recuperación anteriores; después se emite
una sesión nueva y se avisa al correo anterior con la dirección nueva enmascarada.
Si el correo está deshabilitado o falla la entrega, no se cambia la dirección ni
se reemplaza la solicitud vigente.
El código solo vive en memoria en la UI; no se añade a IndexedDB ni a URLs.

Los avisos de cambio de correo y recuperación de contraseña comparten un layout
transaccional con tablas de presentación y estilos inline. Conservan la versión
de texto, escapan los valores dinámicos y no cargan imágenes, fuentes remotas ni
rastreadores. El enlace de recuperación conserva su token en el fragmento de la
URL; el aviso al buzón anterior solo muestra la nueva dirección enmascarada.
Estos cambios visuales no modifican la caducidad ni la validación de los tokens.

## Imágenes y sugerencias

El navegador realiza todo el procesamiento de imágenes. Los workers preservan
la foto original y permiten recuperación ante fallos. Los modelos se cargan
bajo demanda; la cámara y la galería comparten el flujo de captura.

LocalImageStorage cubre pruebas aisladas. Cloudinary recibe las subidas directas
del navegador en los entornos autorizados; Preview tiene un prefijo separado
para imágenes nuevas. La entrega actual de Cloudinary es pública, incluidas
fotos de perfil: conocer la URL permite acceder a la imagen, y revocar un share
no invalida las URLs ya conocidas. No subir fotos sensibles. Las firmas de subida
y finalize protegen la asignación de propietario, no la lectura privada del CDN.
La entrega pública directa es una decisión vigente para evitar el proxy de
imágenes por Vercel, no una garantía de confidencialidad. La revisión adicional
de permisos y comunicación de esta política se sigue en 6; la limpieza por baja,
respetando referencias ajenas, se sigue en 5C.

`recommendOutfits()` es pura y determinista. Lee prendas, conjuntos y calendario
locales, usa una semilla y contexto manual validado, y devuelve hasta tres
sugerencias explicadas. El contexto vive en KV por usuario y no se sincroniza.

## Servidor y límites

- Zod valida los boundaries de formularios, cliente, API y sincronización.
- Drizzle comparte contratos entre SQLite y PostgreSQL; el runtime de Neon usa
  conexiones pooled y las migraciones usan conexión directa.
- Los límites compartidos se guardan en `rate_limit_buckets`; las rutas protegidas
  fallan de forma cerrada si su almacenamiento no está disponible.
- Turnstile es opcional y valida en servidor el token, la acción y el hostname.
  Sus claves se separan por entorno y los tokens solo permanecen en memoria.
- Los permisos se comprueban en servidor. Invitaciones ADMIN vigentes reservan
  plaza y comparten protección transaccional con promociones y reactivaciones.

## Baja de cuentas — implementación local, no operativa

`ACCOUNT_DELETION_ENABLED` y `ACCOUNT_DELETION_REMOTE_CLEANUP_ENABLED` son falsas
por defecto. No se han activado en producción. La migración `0006` solo se ensayó
en una base vacía dedicada de Neon, no en staging ni producción.
La API requiere sesión, origen propio, Zod, límite de intentos y contraseña actual
o prueba Google breve y consumible. Google debe acreditar `auth_time` reciente,
el mismo sujeto enlazado y la misma sesión; el callback nunca ejecuta la baja.

La transacción revoca accesos y credenciales, retira entidades propias y anonimiza
el principal, conservando solo las referencias necesarias. `account_deletions`
impide reactivaciones y escrituras tardías; el último ADMIN activo no puede salir.
`image_deletion_jobs` conserva las claves antes de retirar datos y comprueba
referencias por ID, proveedor/clave y URL. Sus leases y estados preservan reintentos;
los recursos compartidos se conservan. El endpoint interno exige un secreto propio
y el worker rechaza recursos fuera del prefijo autorizado, también en copias de DB.

La confirmación del servidor marca la cuenta en IndexedDB y recarga el documento,
notificando a otras pestañas. Antes de arrancar la app se purgan sus entidades,
outbox y preferencias; se conservan entidades ajenas e imágenes referenciadas.
Cerrar sesión ordinariamente sigue conservando los datos locales.

Pendientes antes de habilitar: PostgreSQL/concurrencia, prueba real de Google,
subidas firmadas en vuelo y huérfanos, recuperación ante respuesta perdida,
worker operativo y reconciliación con un registro de bajas independiente del
respaldo. La retención histórica no equivale a borrado físico inmediato.

## Recuperación y compatibilidad

Los respaldos de PostgreSQL se cifran con age antes de subir a Drive. La política
conserva dos generaciones y verifica las restauraciones en una rama temporal,
con guardas que rechazan el endpoint de producción como destino.

El respaldo de base no incluye binarios remotos ni borradores del navegador.
SQLite y PostgreSQL mantienen esquemas equivalentes para los contratos comunes,
con tipos propios de cada dialecto. Las migraciones aditivas permiten conservar
el despliegue anterior mientras se valida una entrega.

Tecnologías y entornos: [STACK.md](STACK.md). Pendientes: [PHASES.md](PHASES.md).
