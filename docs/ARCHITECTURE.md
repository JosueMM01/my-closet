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

La política compartida para contraseñas nuevas exige 15–128 caracteres y
rechaza una lista local acotada de valores comunes y patrones completos
predecibles. No impone clases de caracteres ni consulta servicios externos;
la lista no equivale a comprobar todas las filtraciones conocidas. Registro
y recuperación validan la misma regla en formulario y API, sin normalizar ni
truncar la contraseña almacenada. El acceso y las comprobaciones de contraseña
actual mantienen compatibilidad con credenciales anteriores: no se cambian
hashes ni se bloquean cuentas por actualizar la política. Esta mejora está
integrada en develop mediante PR #20 y pendiente de promoción a producción.

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

La corrección local de cámara muestra la escena completa con `contain` y separa
el visor de la cabecera y los controles. La captura conserva el cuadro completo
del sensor, sin guardar los márgenes del visor; solo reduce su lado mayor a
1080 píxeles y no aumenta resolución. No fuerza zoom ni una lente específica
del dispositivo. Las pruebas simuladas no sustituyen la validación física.

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

## Acceso Google — simplificación integrada en develop

El registro invitado fija el destinatario: el formulario no permite editar su
correo y Google debe acreditar exactamente el mismo. El alta con contraseña
pide confirmación, sin OTP adicional. La invitación sigue siendo un enlace bearer:
reenviarlo no permite elegir otro correo, pero sí puede permitir completar el
alta del destinatario original. No se afirma que ese flujo pruebe por separado
el control actual del buzón.

El acceso Google conserva el vínculo por su identificador estable `sub`. Solo
si aún no existe vínculo puede asociarse una cuenta activa con correo exacto,
cuando Google sea autoridad del buzón (Gmail o Workspace acreditado por el token).
Para cuentas Google con correo externo se exige una sesión propia autenticada
antes de asociarlas. Nunca se crean cuentas, reemplazan vínculos ni cambian roles
en el inicio de sesión ordinario. Las invitaciones mantienen su flujo separado.

La app no ofrece desvincular Google y su API rechaza esa operación. No se debe
confundir revocar el consentimiento en Google con borrar el vínculo local.
Esta simplificación no identifica todavía si una contraseña fue elegida por el
usuario: las cuentas creadas con Google almacenan una contraseña aleatoria
desconocida, y pueden establecer una mediante recuperación por correo.

## Baja de cuentas — integrada en develop, no operativa en producción

`ACCOUNT_DELETION_ENABLED` y `ACCOUNT_DELETION_REMOTE_CLEANUP_ENABLED` son falsas
por defecto. No se han activado en producción. Las migraciones hasta `0007` se
ensayaron en una base sintética y después se aplicaron a staging (2026-11-09),
conservando sus cinco cuentas, dieciséis imágenes y una prenda. No se aplicaron a producción.
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
worker operativo y ensayo de restauración. La retención histórica no equivale
a borrado físico inmediato.

La baja administrativa está implementada solo en local. Exige ambas banderas
`ACCOUNT_DELETION_ENABLED` y `ADMIN_ACCOUNT_DELETION_ENABLED` (falsas por defecto),
sesión de ADMIN activo y su propia contraseña; no admite la prueba Google de baja
propia para eliminar a otra persona. La transacción revalida sesión, rol y huella
de credencial del actor, exige objetivo distinto y previamente `DISABLED`, y
reutiliza los efectos de la baja propia. El listado excluye principales de
`account_deletions`; el administrador conserva su sesión y no obtiene acceso al
clóset ajeno. Si el refresco posterior falla, se informa baja confirmada y lista
pendiente, sin repetir la eliminación. Si se pierde la respuesta, se pide actualizar
antes de reintentar. Requiere las migraciones `0006` y `0007` antes de desplegar.

### Autorizaciones Cloudinary — implementación solo local

`cloudinary_upload_authorizations` es una tabla en la base existente, no otra base
ni un servicio externo. La migración aditiva `0007` se ensayó únicamente en una
base temporal sintética de Neon y posteriormente en staging; no en producción.
Se registra cada autorización antes de entregar la firma: usuario,
sesión, imagen lógica, clave física única, fecha y estado. Cada revisión obtiene
una clave física distinta, sin sobrescritura, para no romper la edición de fotos.
El cliente finaliza con la autorización exacta; tras consultar Cloudinary, una
transacción revalida cuenta, sesión, propiedad y estado antes de persistirla.
La vía alternativa `POST /api/images` queda reservada al proveedor local, evitando
una subida remota sin inventario cuando falla la firma.

Desactivar una cuenta revoca sus autorizaciones en la base, pero no revoca una
firma en Cloudinary. La limpieza conserva el inventario y vuelve a revisar las
claves tras su ventana de validez y un margen operativo. Un resultado «no
encontrado» no cierra definitivamente la revisión: pueden existir subidas en curso.
Los trabajos protegen referencias ajenas y reintentan fallos. Esta reconciliación
depende de invocar periódicamente el worker; no se ha configurado ni validado un
programador remoto. No se promete una hora exacta de borrado definitivo ni borrar
copias descargadas o cachés ajenas al proveedor.

`0007` y los treinta contratos PostgreSQL ya pasaron en aislamiento. Antes de dar
por validada la baja, comprobar Cloudinary con imágenes sintéticas, observar el worker y
drenar emisores antiguos. Las firmas anteriores a este inventario requieren una
revisión controlada adicional; no borrar carpetas completas ni imágenes reales
por proceder de una copia de la base. Un rollback al emisor antiguo reabre esa
limitación y no debe mantener bajas activas.

Para esta integración se prepararon overrides únicamente de `develop`/Preview:
Neon staging explícito, banderas de baja propia/administrativa y limpieza remota,
secreto del worker separado y prefijo `my-closet-staging`. No cambian las variables
compartidas ni Production. Staging contiene referencias históricas de los prefijos
`my-closet` y `my-closet-preview`: quedan fuera del alcance de esta limpieza.

### Restauración manual: alcance y limitación

Por decisión del propietario se pospone el registro automático externo de bajas:
no se añade otra base ni un servicio nuevo. `account_deletions` sigue dentro del
respaldo y **no** impide por sí solo resucitar cuentas al restaurar una copia antigua.
La recuperación propuesta es manual y cerrada por defecto: restaurar en un entorno
aislado, sin login, sincronización, firmas ni workers destructivos; revocar todas
las sesiones recuperadas y reconciliar las bajas posteriores a la copia antes de
reabrir. Mantener solo la bandera de baja apagada no bloquea los otros accesos.
Si no existe evidencia suficiente para identificar esas bajas, no reabrir la base.
Este procedimiento todavía necesita aceptación y ensayo; no existe una compuerta
automática implementada. Un eventual registro privado del propietario debe quedar
fuera de Git y fuera de la restauración que podría sobrescribirlo. No se usa la
ausencia de fotos de Cloudinary como prueba de una cuenta eliminada.

## Instalación desde Perfil

El proveedor raíz conserva en memoria el evento de instalación de Chromium antes
de navegar al perfil. El botón consume ese evento una sola vez; aceptar el aviso
no se presenta como instalación terminada hasta recibir `appinstalled`. Sin oferta
nativa se muestran opciones manuales; en modo standalone se oculta la oferta.
Si un simulador incrusta la app, se ofrece abrir el mismo perfil en una pestaña
propia. No se relajan las protecciones anti-iframe del servidor para soportarlo.
El modo de desarrollo desregistra el service worker y limpia únicamente cachés
estática/runtime: la instalación se valida con una compilación final local o
Preview, sin borrar IndexedDB ni confundir emulación con un dispositivo físico.

## Recuperación y compatibilidad

Los respaldos de PostgreSQL se cifran con age antes de subir a Drive. La política
conserva dos generaciones y verifica las restauraciones en una rama temporal,
con guardas que rechazan el endpoint de producción como destino.

El respaldo de base no incluye binarios remotos ni borradores del navegador.
SQLite y PostgreSQL mantienen esquemas equivalentes para los contratos comunes,
con tipos propios de cada dialecto. Las migraciones aditivas permiten conservar
el despliegue anterior mientras se valida una entrega.

Tecnologías y entornos: [STACK.md](STACK.md). Pendientes: [PHASES.md](PHASES.md).
