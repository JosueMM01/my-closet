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
- Contratos SQL: cuatro pruebas en tablas temporales, copiando estructura y
  restricciones. No insertan, actualizan ni borran cuentas públicas existentes.
- Build/E2E: checkout aislado, SQLite sintética y puerto 3100; no apuntan a Neon.
  Emulación móvil no sustituye pruebas en Samsung/Xiaomi físicos.

No limpiar datos del navegador como primer intento ante un fallo. No importar
credenciales de producción para superar un error de staging. Fotos históricas
Cloudinary o SMTP real no quedaron certificados en esta sesión.

## 5A — Invitaciones y cupo ADMIN (relevante)

Implementado: comprobación en servidor dentro de la creación transaccional,
rechazo HTTP 409 antes de persistencia/envío, y bloqueo de la opción ADMIN en UI.
Se mantiene la guarda de aceptación de invitación y límite de dos admins activos
de la base de datos. No hay migraciones ni nuevos campos.

Pruebas automatizadas: 37 casos dirigidos de cuentas/invitaciones/OAuth/correo,
cuatro contratos PostgreSQL staging, ocho E2E de administración/invitaciones
en Chromium móvil/escritorio y controles TypeScript/lint/build local.

Supervisión del propietario:

- [ ] En Perfil staging, con dos administradores activos, actualizar datos y
  confirmar que ADMIN no se puede seleccionar y aparece «Cupo completo».
- [ ] Confirmar que invitar como Usuario sigue disponible. En este servidor el
  resultado debe decir «capturada para pruebas», no «enviada por correo».
- [ ] Con un solo admin y el segundo deshabilitado, ADMIN puede seleccionarse;
  no deshabilitar cuentas reales solo para probar este caso: ya tiene contrato.
- [ ] Aprobar la regla conservada: invitaciones pendientes NO reservan plaza;
  pueden emitirse varias mientras quede cupo, pero al aceptar se vuelve a validar.
  Una invitación antigua nunca permite crear un tercer administrador activo.
- [ ] Si otro dispositivo cambia el cupo, la caché visual puede tardar en mostrarlo;
  el servidor igualmente rechaza la solicitud que ya no tenga cupo.

## 4B — Textos públicos y OAuth (relevante; no cerrada)

- [ ] Revisar `/about`, `/privacy` y `/terms` sin sesión; contenido legible,
  enlaces correctos, sin exponer fotos/datos privados ni cargar el modelo.
- [ ] Aprobar responsable y correo de contacto públicos para
  `PUBLIC_LEGAL_OPERATOR_NAME` y `PUBLIC_LEGAL_CONTACT_EMAIL`. No usar datos
  del administrador automáticamente. Mientras falten, se indica revisión/noindex.
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
- 5C: baja irreversible con reautenticación y ELIMINAR; limpieza durable de
  Neon/Cloudinary con referencias/clones, sesiones, cachés y retención en backups.
  Requiere aprobar consecuencias antes de implementar/publicar; entrega separada.
- 6: medir optimización de modelos en dispositivos físicos; no eliminar modelos
  ni prometer 15 segundos sin comparar calidad, backend y caché fría/caliente.

## Autorización Git y presupuesto

Rama actual: `fix/admin-invitation-capacity-phase-5a`, creada desde `develop`
con dependencias locales de 4A/4B por fast-forward. Código y documentación en
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
