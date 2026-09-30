# Respaldos y recuperación de PostgreSQL

Estado al 2026-09-30: implementación existente; cierre operativo de 4A pendiente
de evidencia de copia, restauración, rotación y scheduler. 4B trata publicación
OAuth y continuidad. Véase [ROADMAP.md](ROADMAP.md).

## Checkpoint de fase 4A — 2026-09-30

| Comprobación | Evidencia actual |
|---|---|
| Configuración local | `.env.local.backup` ignorado por Git; variables requeridas presentes, sin imprimir secretos |
| Google Drive | Renovación OAuth y listado de carpeta reales correctos, sin crear ni borrar archivos; corresponde crear copia |
| Neon | API confirma proyecto, rama main y endpoint esperado; URL directa y TLS validados localmente |
| GitHub Actions | Seis Secrets y siete Variables registrados; GitHub no permite releer valores de Secrets para certificar equivalencia |
| Workflow local | `actionlint` 1.7.12 correcto; guardas de restauración antes de DROP y limpieza solo de rama recién creada |
| Tests locales | 13 pruebas dirigidas de política/Drive correctas; TypeScript, lint dirigido y diff-check correctos |
| Integración | PR #7 abierto hacia main; correcciones locales todavía no publicadas; workflow ausente en main |
| Cierre operativo | Copia real, restauración, rotación y scheduler pendientes; no declarar fase cerrada |

Los tests Drive usan fixtures y red simulada: prueban publicación tras verificar
tamaño/MD5, rechazo de manifiesto corrupto y parada ante revocación OAuth. No
sustituyen pg_dump, cifrado age ni restauración reales. La renovación comprobada
hoy tampoco garantiza vigencia futura del token (fase 4B).

### Guardas adicionales

- Una generación cuenta para elegibilidad/retención solo con manifiesto y archivo
  completos, mismo runId y archivo no vacío; manifiestos duplicados no ocupan
  varias posiciones. Un manifiesto huérfano no desplaza una copia recuperable.
- El manifiesto se publica como completo después de verificar su tamaño y MD5;
  una carga corrupta detiene el flujo antes de rotar copias.
- No limpiar incompletos de más de 48 horas mientras falten las dos generaciones
  completas requeridas. No retirar archivos ajenos a archive/manifest del respaldo.
- Antes de DROP/pg_restore exigir rama nueva, ID Neon, endpoint directo distinto
  de producción, URL coincidente con el host devuelto por la acción, base esperada
  y TLS. Si la acción reutiliza una rama, ni restaurarla ni borrarla automáticamente.

### Próximo ensayo autorizado

1. Publicar las correcciones, dirigir el PR a develop y completar la integración
   develop → main con revisión; evitar un build Vercel innecesario para respaldos.
2. Ejecutar manualmente copia forzada y restauración temporal; guardar URL de run,
   commit, resultado y limpieza. No restaurar ni migrar la rama de producción.
3. Crear segunda y tercera generación; verificar retención de las dos últimas.
4. Ejecutar sin forzar y comprobar omisión dentro del intervalo.
5. Comprobar scheduler real y configurar/verificar alertas de fallo y copia
   atrasada. Hasta tener esta evidencia, 4A sigue pendiente de operación.

La base de producción se respalda fuera de Vercel y fuera de una petición de
la aplicación. El workflow `.github/workflows/database-backup.yml` consulta
Google Drive diariamente a las `00:00` de `America/Mexico_City`, pero solo crea
un `pg_dump` cuando han transcurrido al menos ocho días desde el último éxito.

El dump usa la conexión directa de Neon, se valida con `pg_restore --list`, se
cifra con age antes de salir del runner y se sube mediante una sesión reanudable.
Drive confirma tamaño y MD5; además, un manifiesto conserva SHA-256 del dump
original y del archivo cifrado. La rotación comienza únicamente después de que
la nueva pareja archivo/manifiesto está completa y conserva las dos generaciones
más recientes.

## Separación de credenciales

Estas credenciales pertenecen exclusivamente a GitHub Actions. No deben
copiarse a Vercel, al frontend ni a las variables de Google Sign-In.

### Secrets de Actions

| Nombre | Contenido |
|---|---|
| `NEON_DATABASE_URL_UNPOOLED` | URL directa de la rama de producción; el host no contiene `-pooler` |
| `NEON_API_KEY` | API key de Neon con acceso al proyecto para crear y borrar la rama temporal |
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID` | Cliente OAuth separado para respaldos |
| `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | Secreto del cliente OAuth de respaldos |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Token offline con alcance `drive.file` |
| `BACKUP_AGE_IDENTITY` | Identidad privada age completa; solo se usa al verificar restauraciones |

### Variables de Actions

| Nombre | Valor esperado |
|---|---|
| `NEON_PROJECT_ID` | ID del proyecto que contiene Neon producción |
| `NEON_PRODUCTION_BRANCH` | Nombre o ID de la rama de producción, normalmente `main` |
| `NEON_PRODUCTION_ENDPOINT_HOST` | Host exacto de la URL directa de producción, sin usuario, contraseña ni `-pooler` |
| `NEON_DATABASE_NAME` | Nombre de la base, normalmente `neondb` |
| `NEON_DATABASE_ROLE` | Rol propietario usado para la rama temporal, normalmente `neondb_owner` |
| `GOOGLE_DRIVE_BACKUP_FOLDER_ID` | ID de la carpeta creada por el cliente de respaldo |
| `BACKUP_AGE_RECIPIENT` | Clave pública age que comienza con `age1` |

Los nombres de proyecto, rama, base y rol deben comprobarse en Neon. Una rama
Git `main` y una rama Neon `main` son recursos diferentes; coincidir en el
nombre no demuestra que sea el destino correcto. El workflow compara el host
real de `NEON_DATABASE_URL_UNPOOLED` con `NEON_PRODUCTION_ENDPOINT_HOST` y
también comprueba base, protocolo, TLS y ausencia de `-pooler` antes de abrir la
conexión.

## Preparar Google Drive

1. En Google Cloud, habilitar Google Drive API.
2. Crear un cliente OAuth exclusivo llamado, por ejemplo, `My Closet Backups`.
   No reutilizar el cliente OIDC del inicio de sesión.
3. Obtener una autorización offline para
   `https://www.googleapis.com/auth/drive.file`. El flujo debe devolver un
   refresh token; se recomienda usar `prompt=consent` durante la autorización
   inicial.
4. Guardar temporalmente las tres credenciales OAuth en un archivo local
   `.env.local.backup`, que queda cubierto por `.env*` en `.gitignore`:

```dotenv
GOOGLE_DRIVE_OAUTH_CLIENT_ID=
GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
```

5. Crear la carpeta mediante el mismo cliente OAuth para que el alcance
   restringido `drive.file` pueda administrarla:

`node --env-file=.env.local.backup scripts/backups/google-drive-backup.mts init-folder`

6. Copiar solamente el ID mostrado a `GOOGLE_DRIVE_BACKUP_FOLDER_ID`, cargar
   las tres credenciales como Secrets de Actions y eliminar el archivo local
   cuando ya no sea necesario.

El refresh token puede ser revocado por Google o por el propietario. Un fallo
de renovación detiene el workflow antes de crear o eliminar archivos y debe
resolverse generando una nueva autorización offline.

En OAuth externo en Testing, el refresh token con permisos Drive normalmente
vence en siete días. Una copia de prueba no demuestra continuidad cada ocho días.
Publicar no garantiza token permanente: obtener autorización nueva, comprobar
renovación y definir alertas de `invalid_grant` y copia atrasada. No reutilizar
credenciales o sesiones Google Sign-In para Drive.

## Preparar el cifrado

Generar una identidad age fuera del repositorio. La identidad privada debe
guardarse también en un gestor de contraseñas; GitHub no debe ser su única
copia. `age-keygen` crea la identidad y `age-keygen -y` deriva el recipient
público.

- La identidad completa va a `BACKUP_AGE_IDENTITY`.
- El recipient público `age1...` va a `BACKUP_AGE_RECIPIENT`.
- Ninguno de los dos se escribe en `.env`, documentación, logs o commits.

Sin la identidad privada, los dumps cifrados son irrecuperables. Una copia que
existe pero no puede descifrarse es decoración cara, no un respaldo.

## Primera puesta en marcha

El workflow programado solo se ejecuta desde la rama predeterminada de GitHub,
por lo que debe llegar a `main` antes de operar automáticamente.

Seguir rama de trabajo → develop → main, sin saltar integración por el scheduler.
GitHub puede retrasar/perder trabajos programados y, en repositorios públicos,
desactivarlos tras 60 días sin actividad. Las `00:00` son hora prevista, no una
garantía exacta. Detectar ausencia de ejecuciones, además de jobs fallidos.

1. Ejecutar manualmente `Database backup` con `force_backup=true` y
   `verify_restore=true`.
2. Confirmar que el job de respaldo subió un archivo `.dump.age` y su
   `.manifest.json` sin publicar artefactos del runner.
3. Confirmar que la restauración creó una rama temporal, aplicó el dump,
   verificó tablas y relaciones y eliminó la rama al terminar.
4. Ejecutar una segunda copia forzada para completar la ventana de dos copias.
5. Ejecutar una tercera copia forzada y comprobar que Drive conserva únicamente
   las dos generaciones completas más recientes.
6. Ejecutar de nuevo sin forzar y comprobar que el workflow informa que la
   copia todavía está vigente.

La rama temporal tiene expiración de dos horas como segunda barrera de limpieza
si GitHub no consigue borrarla. En Neon Free conviene verificar después de cada
ensayo que no queden ramas `backup-restore-*` abandonadas.

## Qué valida una restauración

La verificación descarga la última pareja completa, comprueba el SHA-256 del
archivo cifrado, descifra, comprueba el SHA-256 del dump y ejecuta
`pg_restore --list`. Después restaura con `--clean --if-exists` únicamente en
una rama Neon temporal y comprueba:

- presencia de las diez tablas requeridas;
- ausencia de prendas, conjuntos, calendario, imágenes y shares huérfanos;
- consulta correcta de conteos básicos;
- versión PostgreSQL del destino, que se registra en el manifiesto.

La aplicación permanece disponible durante `pg_dump`: PostgreSQL entrega una
vista consistente sin bloquear las escrituras ordinarias. El modo mantenimiento
se reserva para una restauración real sobre producción, que nunca debe
automatizarse desde este workflow.

El dump contiene PostgreSQL, no binarios Cloudinary ni borradores pendientes en
IndexedDB. Documentar retención/recuperación de imágenes aparte; estas copias no
son un respaldo completo de todos los recursos de la aplicación.

## Respuesta a incidentes

- Si falla antes de subir el manifiesto, la copia no se considera completa y no
  participa en la retención.
- Los archivos incompletos de más de 48 horas se retiran solo después de que una
  nueva copia se haya verificado.
- Si falla la rotación, el job falla dejando copias adicionales; prioriza ocupar
  espacio antes que perder la ventana recuperable.
- Si falla el borrado de la rama temporal, su expiración limita la fuga de
  recursos, pero debe revisarse Neon manualmente.
- Para una restauración real, detener primero cambios destructivos, conservar el
  estado afectado en otra rama, restaurar en una rama nueva, validar y decidir
  el cambio de destino de forma explícita. Nunca restaurar directamente sobre
  `main` desde un job programado.
