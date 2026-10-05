# Revisión manual y puertas de publicación

Fecha: 2026-10-04. Trabajo preparado localmente; no equivale a despliegue.
Plan vigente: [ROADMAP.md](ROADMAP.md).

## Entorno de esta sesión

- App: `http://localhost:3001`, solo en este equipo (bind 127.0.0.1).
- Neon: proyecto `nameless-rice-26203399`, staging `br-holy-rain-a6760d7r`.
  Destino contrastado por API y conexión SQL con producción
  `br-cold-night-a6r5p6l3`. La rama Git no elige la base de datos.
- Servidor con `.env.local` en memoria, pero overrides de seguridad únicamente
  en el proceso: `IMAGE_PROVIDER=local`, `EMAIL_PROVIDER=capture`, bootstrap vacío.
  No se modifican credenciales ni archivos privados. Reiniciar con otro comando
  puede usar el SMTP/Cloudinary configurado realmente en `.env.local`.
- Google permanece habilitado como en el archivo local. Su prueba interactiva
  requiere usuario staging ya vinculado y callback autorizado de localhost:3001.
  Usar inicialmente una ventana privada permite probar sin modificar los datos
  de otro perfil previamente guardado en este origen.
- Contratos SQL: ocho pruebas en tablas temporales, copiando estructura y
  restricciones. No insertan, actualizan ni borran cuentas públicas existentes.
- Build/E2E: checkout aislado, SQLite sintética y puerto 3100; no apuntan a Neon.
  Emulación móvil no sustituye pruebas en Samsung/Xiaomi físicos.

No limpiar datos del navegador como primer intento ante un fallo. No importar
credenciales de producción para superar un error de staging. Fotos históricas
Cloudinary o SMTP real no quedaron certificados en esta sesión.

## 5A — Invitaciones y cupo ADMIN (relevante)

Implementado: activos + ADMIN pendientes/vigentes <= 2, con reserva transaccional,
rechazo HTTP 409 antes de persistencia/envío y bloqueo de ADMIN en UI. Promociones
y reactivaciones respetan reservas. Al aceptar con contraseña o Google, la reserva
se convierte en cuenta ADMIN, sin contar dos veces. Revocación/caducidad liberan plaza.
PostgreSQL serializa escritores antes de bloquear filas; no hay migraciones.

Ampliación: 62 casos dirigidos de cuentas/invitaciones/OAuth, ocho contratos
PostgreSQL staging (incluido bloqueo entre conexiones) y TypeScript/lint/build local.
22 ejecuciones E2E dirigidas aprobadas en Chromium móvil/escritorio (~1,1 min),
incluidas reserva/revocación, caducidad sin recargar e icono de Google en login.
Los contratos usan 20 s por caso para consultas remotas; no se amplía el timeout
de pruebas unitarias ni se certifican carreras de datos compartidos en producción.

Supervisión del propietario:

- [x] Propietario confirma en localhost:3001 que el cupo ADMIN bloquea un tercero;
  aprueba el botón de Google y las páginas públicas. No equivale a validar SMTP
  real, aceptación manual de invitaciones ni automatización de respaldos.
- [ ] En Perfil staging, con dos administradores activos, actualizar datos y
  confirmar que ADMIN no se puede seleccionar y aparece «Cupo completo».
- [ ] Confirmar que invitar como Usuario sigue disponible. En este servidor el
  resultado debe decir «capturada para pruebas», no «enviada por correo».
- [ ] Con un solo admin y el segundo deshabilitado, ADMIN puede seleccionarse;
  no deshabilitar cuentas reales solo para probar este caso: ya tiene contrato.
- [x] Propietario aprueba que ADMIN pendiente/vigente reserve plaza.
- [ ] Con un activo, crear una invitación ADMIN: ver «1 plaza reservada», opción
  ADMIN bloqueada y mensaje «Revoca una invitación ADMIN…». USER sigue disponible.
- [ ] Revocar esa invitación: desaparece la reserva y ADMIN vuelve a estar disponible.
- [ ] Aceptar otra en ventana privada de la misma laptop: pasa a dos activos,
  cero reservas; no permite un tercero. Hay pruebas automáticas para ambos métodos.
- [ ] Si existen invitaciones antiguas sobreasignadas, revocar las sobrantes;
  no se borra/revoca ninguna automáticamente ni se modifica su rol.
- [ ] Si otro dispositivo cambia el cupo, la caché visual puede tardar en mostrarlo;
  el servidor igualmente rechaza la solicitud que ya no tenga cupo.

## 4B — Textos públicos y OAuth (relevante; no cerrada)

- [ ] Revisar `/about`, `/privacy` y `/terms` sin sesión; contenido legible,
  enlaces correctos, sin exponer fotos/datos privados ni cargar el modelo.
- [x] Responsable/contacto aprobados: Josue Martinez, contacto@josuem01.dev.
  Defaults públicos versionados; `PUBLIC_LEGAL_OPERATOR_NAME` y
  `PUBLIC_LEGAL_CONTACT_EMAIL` son overrides opcionales, no secretos.
- [ ] Aprobar cobertura real: IndexedDB, Neon, Cloudinary, servicios de correo,
  OAuth y respaldos. Los textos no certifican cumplimiento legal.
- [ ] Autorizar integración/despliegue y después revisar URLs públicas reales,
  configuración separada de Google Sign-In y Drive y permisos mínimos.
- [ ] Publicar/configurar Google según sus requisitos; renovar autorización Drive,
  actualizar el Secret autorizado y probar refresh y copia sin exponer tokens.
  Un refresh token no es permanente ni inmune a revocación.

## 4A — Operación del respaldo (relevante; cierre pendiente)

La restauración temporal, contenido/relaciones, rotación a dos generaciones y
omisión dentro de ocho días ya tienen evidencia en
[BACKUP_RECOVERY_EVIDENCE.md](BACKUP_RECOVERY_EVIDENCE.md). No repetir una
restauración sobre producción.

- [ ] Autorizar publicación de las correcciones del workflow; el publicado
  conserva el problema de runner.temp. No confundir ensayo local con Actions.
- [ ] Comprobar run manual hospedado, ejecución programada real y avisos de fallo
  y respaldo atrasado, incluido scheduler que deje de ejecutarse.
- [ ] Custodiar la identidad privada age fuera del repositorio y de Actions;
  recordar que el dump no incluye binarios Cloudinary ni borradores offline.

## 5B / 5C — Próximas puertas

- 5B: corregir reautenticación sin perder IndexedDB/outbox ni sincronizar datos
  con una identidad distinta; límites compartidos, verificación del nuevo correo
  y pruebas negativas de permisos. El login actual usa perfil local para
  redirigir: puede impedir «Iniciar sesión de nuevo». Aún no está corregido.
- 5B: privacidad Cloudinary aprobada; originales/derivados privados, autorización
  de lecturas y migración de URLs públicas antiguas. Comprobar acceso anónimo y
  entre usuarios, shares, revocación, perfil y blobs offline. Una URL firmada no
  equivale a exigir sesión y debe evaluarse el coste de cada estrategia.
- 5C: baja irreversible con reautenticación y ELIMINAR; limpieza durable de
  Neon/Cloudinary con referencias/clones, sesiones, cachés y retención en backups.
  Requiere aprobar consecuencias antes de implementar/publicar; entrega separada.

## Entrega agrupada autorizada — 2026-10-04

- El propietario autoriza push de 4A/4B/5A y PR de la rama de trabajo a develop;
  no autoriza fusionar automáticamente ni modificar main en esta entrega.
- Aceptación manual de invitaciones sigue fallando según el propietario incluso
  al abrir otra pestaña. No se considera validada por el bloqueo del tercer ADMIN.
  Reproducir en preview staging con contexto privado: enlace exacto, caducidad,
  respuesta de registro, sesión y redirección, sin registrar tokens ni correos.
- Consulta read-only de la carpeta de respaldo: dos .dump.age (49 835 bytes cada
  uno), ambos con cabecera age válida, y dos manifiestos JSON. No se volvió a descifrar/restaurar; evidencia previa
  de recuperación en BACKUP_RECOVERY_EVIDENCE.md. Ningún archivo modificado.
- Vercel consultado: DATABASE_URL y NEXT_PUBLIC_APP_URL comparten Preview y
  Production. No crear un preview de prueba con esa configuración. Esta rama
  omite deployments automáticos hasta autorizar variables Preview aisladas para
  staging y luego un único preview; CI de PR usa su base sintética independiente.
- La cifra anterior de Deployment Storage (1,79/10 GB) no se ha actualizado en
  esta revisión. No se presume presupuesto disponible ni se dispara redeploy.
- 6: medir optimización de modelos en dispositivos físicos; no eliminar modelos
  ni prometer 15 segundos sin comparar calidad, backend y caché fría/caliente.

## Seguimiento: acceso e invitaciones locales

- [ ] Confirmar en localhost:3001 el texto «Iniciar sesión con Google», candado
  visible, G oficial en login/registro y mensajes ante cuenta no vinculada/cancelación.
  No manipular credenciales reales para provocar fallos; hay pruebas sintéticas.
- [ ] Para aceptar una invitación local: copiar el enlace y abrir una ventana
  privada EN LA MISMA LAPTOP, conservando `#invite=...`. La sesión del admin en
  otra ventana no debe sustituir el formulario de registro del invitado.
- [ ] No cambiar localhost por el dominio de producción: el token pertenece a
  staging y no funcionará en otra base. En otro equipo/teléfono, localhost señala
  ese dispositivo; LAN/preview requiere preparar entorno aparte, no basta con
  editar el enlace (especialmente Google OAuth).
- [x] Propietario confirma pruebas en localhost:3001, no cambios publicados en Vercel.
- [ ] Avisos fijos dentro de la app: plan 7A, todavía no implementado.
  Push opcional: 7B; no sustituye errores de formulario ni pide permiso ahora.

## Autorización Git y presupuesto

Rama actual: `fix/admin-invitation-seat-reservations-phase-5a`, creada desde `develop`
con dependencias locales de 4A/4B/5A por fast-forward. Código y documentación en
commits separados. Los cambios previos del propietario en `.env.example` y
`.gitignore` no pertenecen a esta entrega.

Flujo real: rama → PR a `develop` → validación → PR de lanzamiento a `main`.
No se llama `development` en este repositorio. No hacer push/PR/merge sin
confirmación expresa; un push por sí solo puede generar un preview.

Referencia anterior de Vercel: Deployment Storage 1,79/10 GB; no es una nueva
lectura. No hubo despliegues/previews en esta sesión. Builds y tests locales
no consumen ese almacenamiento remoto. Los cambios funcionales de 4B/5A sí
requieren validar el próximo deployment; agrupar una entrega revisable con
commits independientes reduce publicaciones innecesarias, no garantiza un
único build ni permite omitir revisión de seguridad.
