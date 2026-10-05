# Fase 4B — Páginas públicas y continuidad OAuth

Preparación local: 2026-10-04. Este procedimiento no publica clientes Google,
no garantiza un token permanente y no modifica Secrets sin autorización.

## Contenido público preparado

| Uso | URL prevista después del lanzamiento |
|---|---|
| Presentación / página de inicio OAuth | https://my-closet.josuem01.dev/about |
| Política de privacidad | https://my-closet.josuem01.dev/privacy |
| Términos de uso | https://my-closet.josuem01.dev/terms |

La raíz `/` continúa siendo el inicio privado del armario. No utilizarla como
presentación pública para revisión de Google. Las tres rutas nuevas son páginas
server-rendered sin sesión, IndexedDB, sincronización ni registro de Service
Worker; no solicitan modelos. Los enlaces también funcionan sin JavaScript.
Login y registro enlazan estos documentos sin precargar las rutas.

El propietario debe revisar y aprobar el contenido antes de publicarlo. No
constituye una certificación legal. Refleja los límites actuales: imágenes por
URL en Cloudinary, marcadores de borrado, limpieza/baja completa pendientes,
respaldo de base de datos sin imágenes y automatización todavía en validación.
Si cambia alguna práctica, deben revisarse los textos.

## Responsable y contacto aprobados

El propietario aprobó estos datos públicos el 4 de octubre de 2026. Se incluyen
como defaults versionados, sin derivarlos de credenciales privadas. No hace falta
añadir variables a Vercel para usarlos. Overrides opcionales, visibles en Internet:

```dotenv
PUBLIC_LEGAL_OPERATOR_NAME="Josue Martinez"
PUBLIC_LEGAL_CONTACT_EMAIL="contacto@josuem01.dev"
```

No son secretos, pero no deben derivarse del administrador, bootstrap, SMTP o
los clientes OAuth. No utilizan prefijo NEXT_PUBLIC: se renderizan en servidor
y se incorporan al HTML durante el build. Si faltan variables se usan los datos
aprobados, nunca SMTP/bootstrap. Overrides explícitamente vacíos mantienen
revisión/noindex; esto bloquea el cierre de 4B, no rompe
el acceso a la app. Una configuración inválida falla sin imprimir su valor.
Cambiar estos campos requiere un nuevo build para actualizar el HTML.

Siguen pendientes revisión completa de textos, despliegue, publicación de Google
y renovación de Drive. Aprobar identidad/contacto no certifica cumplimiento legal
ni que Google haya aprobado la aplicación.

No se alteraron `.env.example`, `.env.local`, `.env.prod` o `.env.local.backup`
en esta fase. Las URLs anteriores no estarán disponibles en producción hasta
integrar y desplegar los cambios con autorización.

## Dos clientes, dos objetivos

| Configuración | Google Sign-In | Respaldos Drive |
|---|---|---|
| Propósito | Identidad de cuentas autorizadas | Copias cifradas en Drive del responsable |
| Permisos | `openid email profile` | `https://www.googleapis.com/auth/drive.file` |
| Variables | GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | GOOGLE_DRIVE_OAUTH_CLIENT_ID / GOOGLE_DRIVE_OAUTH_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN |
| Dónde se usan | Vercel y entorno de prueba de la app | GitHub Actions y archivo local de respaldo ignorado |
| Redirect actual | `/api/auth/google/callback` | `https://developers.google.com/oauthplayground` si se mantiene el procedimiento actual |

No existe un callback de Drive en la app. No inventar una URL con el dominio de
My Closet para el flujo del Playground. Su configuración debe usar **las
credenciales propias del proyecto de respaldos**, no las predeterminadas del
Playground. No pedir permisos completos de Drive ni reutilizar el cliente de
Sign-In. `drive.file` permite los archivos creados/seleccionados para ese cliente;
comprobar acceso a la carpeta y copias existentes antes de cambiar de cliente.

## Publicación en Google Cloud: después del lanzamiento revisado

1. Aprobar identidad/contacto y los textos. Integrar cambios revisados a develop
   y posteriormente a main, agrupando la entrega de la web para evitar previews
   redundantes. Un push puede generar build aunque no se abra un PR.
2. Comprobar las tres URLs públicas en incógnito, sin sesión, por HTTPS y sin
   protección de deployment. No usar la URL de un preview protegido para Google.
3. En el proyecto **de respaldos**, revisar Google Auth Platform: Branding,
   Audience, Data Access y Clients. Nombre real de la app, correo de soporte y
   contacto aprobados; homepage `/about`, privacidad `/privacy`, términos `/terms`.
4. Revisar el dominio autorizado registrable `josuem01.dev` y su verificación
   en Search Console si Google la solicita. Los dominios autorizados no llevan
   protocolo ni ruta. Revisar por separado el proyecto de Sign-In; no cambiar
   su callback de producción `https://my-closet.josuem01.dev/api/auth/google/callback`.
5. Mantener únicamente el permiso necesario `drive.file` y seguir las exigencias
   de publicación/verificación que muestre Google. Pasar a Production no implica
   que se haya aprobado una verificación ni que se hayan omitido sus requisitos.
6. Después del cambio, realizar una autorización offline nueva con el mismo
   cliente de respaldos. Reemplazar GOOGLE_DRIVE_REFRESH_TOKEN únicamente con
   autorización del propietario en el archivo ignorado y en GitHub Secrets.
   No copiar tokens a docs, incidencias, PR, terminal o capturas.
7. Demostrar renovación, listado de copias y acceso a la carpeta; ejecutar el
   workflow corregido de 4A. No forzar backups innecesarios ni restaurar sobre
   producción. Registrar fechas y resultados sin datos personales.
8. Comprobar ejecución programada después del intervalo y que los avisos de
   fallo llegan al responsable. Configurar/validar vigilancia de copia atrasada,
   también cuando GitHub deje de lanzar el workflow: un job inexistente no puede
   emitir su propia alerta. Este último punto sigue pendiente de 4A.

## Expiración, revocación y diagnóstico

Un refresh token de una app External en Testing que solicita Drive suele vencer
a los siete días. La excepción de Testing para permisos básicos de identidad
no sirve para Drive. Por eso el login de Google y los respaldos no tienen la
misma continuidad. Un access token de una hora se renueva con el refresh token;
su vencimiento por sí solo no obliga a iniciar sesión de nuevo en My Closet.

Production evita el vencimiento fijo propio de Testing, pero no crea un token
permanente: el usuario puede revocarlo, pueden cambiar políticas/credenciales o
existir otros límites. Nunca tratar la expiración estimada como garantía.

El script identifica `invalid_grant`, `invalid_client` e `invalid_scope` y da
instrucciones acotadas. No imprime el cuerpo ni error_description de Google.
La renovación falla **antes** de listar/subir/borrar copias; conservar siempre
las generaciones existentes y no ejecutar rotación para resolver un fallo OAuth.
Los rechazos desconocidos/HTML conservan el estado HTTP sin mostrar su contenido.
Consultar el fallo en Actions y reautorizar con el cliente correcto si corresponde.

## Cierre de 4B

- [ ] Responsable/correo públicos y contenido aprobados por el propietario.
- [ ] URLs desplegadas y accesibles sin sesión/protección de preview.
- [ ] Dominio, branding, permisos y publicación revisados en ambos proyectos.
- [ ] Nueva autorización Drive y Secret actualizados con aprobación.
- [ ] Renovación y copia reales comprobadas fuera del modo Testing.
- [ ] Avisos operativos de fallo y copia atrasada comprobados con 4A.

Preparar páginas y pasar pruebas locales no marca automáticamente estas casillas.

## Validación local del 4 de octubre

- 50 pruebas Vitest dirigidas: contacto público, rechazo OAuth, política de
  respaldos, workflow y omisión de builds.
- 16 pruebas Playwright en móvil/escritorio: tres rutas públicas, lectura sin
  JavaScript, enlaces de acceso/registro, registro, login/logout y guarda privada.
- Dos pruebas offline en escritorio: recarga de detalle y guardado local seguido
  de sincronización al reconectar. No se repitió la suite E2E completa.
- TypeScript, lint dirigido, diff sin errores de espacio y build local correctos.
- Build con SQLite E2E, imágenes locales, correo capture y Google deshabilitado;
  bootstrap vacío. Sin conexiones a Neon, Drive, SMTP real o Cloudinary.
- Las rutas públicas generadas como estáticas: HTML de `/about` 18 831 bytes,
  `/privacy` 26 064 bytes y `/terms` 22 574 bytes, antes de compresión HTTP.
  No se añadieron assets de imagen, fuentes o modelos; estos tamaños no representan
  el deployment completo, que conserva los modelos existentes de la aplicación.
- Cero pushes, PR o despliegues. Referencia de Vercel anterior: Deployment Storage
  1,79/10 GB; no se consultó nuevamente el contador ni se modificó su retención.

## Referencias oficiales

- [Cumplimiento y preparación para producción](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
- [Verificación de marca y URLs públicas](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
- [OAuth y vencimiento de refresh tokens](https://developers.google.com/identity/protocols/oauth2).
- [Permisos mínimos de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
