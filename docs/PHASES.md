# Fases de My Closet

Actualización: 2026-10-25. Este archivo conserva el plan público del proyecto.
La implementación, la integración, la publicación y la validación en uso son
estados distintos; aprobar CI no cierra por sí solo una fase.

## Base funcional integrada

La aplicación incluye armario, conjuntos, sugerencias locales y calendario;
sesión, Google Sign-In, registro por invitación y administración; sincronización
offline-first, PostgreSQL y almacenamiento remoto de imágenes. Las sugerencias
son deterministas y locales, sin llamadas a modelos de lenguaje.

## Ciclo de mejora vigente

| Fase | Estado | Cierre o seguimiento operativo |
|---|---|---|
| 4A — Respaldos y recuperación | Lista: copia cifrada, retención de dos generaciones, restauración aislada y continuidad programada comprobadas; cierre operativo aceptado por el propietario | Seguimiento manual a cargo del propietario, con la frecuencia y cobertura documentadas; alerta independiente de copia atrasada como mejora pendiente, no como bloqueo de esta entrega |
| 4B — Publicación OAuth | Lista: páginas públicas y cliente de respaldos publicados; renovación comprobada | Seguimiento del propietario: atender fallos de autorización y mantener permisos y textos públicos vigentes; no bloquea el cierre de esta entrega |
| 5A — Invitaciones y cupo ADMIN | Lista funcionalmente; aceptación del propietario y protección transaccional del cupo de dos ADMIN, incluidas reservas vigentes | Publicar el endurecimiento adicional: los siete días de vigencia ya se calculan en servidor en la rama actual, sin confiar en la fecha del cliente |
| 5B — Seguridad e identidad | Lista en su alcance funcional, aceptado por el propietario: cambio de correo verificado y Turnstile operativos en producción | Las comprobaciones adicionales de permisos, política de imágenes y ensayo de reutilización real se siguen en 6, sin afirmar que ya se ejecutaron |
| 5C — Baja de cuentas | Implementación local en proceso: API, modal, reautenticación, transacción y cola de limpieza; desactivada en producción | Validar PostgreSQL y concurrencia, Google real y UX; cubrir firmas de subida pendientes y assets huérfanos; completar registro de bajas independiente del respaldo, restauración y operación del worker antes de habilitar |
| 6 — Experiencia y documentación | En proceso; estilos de avisos de correo y recuperación implementados y probados localmente; capturas reales preparadas en README; documentación pública curada | Revisar y publicar estas mejoras; simplificar el perfil y confirmar el cambio de contraseña por correo; completar matriz de permisos y revocación, claridad de la entrega pública de imágenes y ensayo adicional de reutilización de Turnstile; Web Push se evalúa aparte |
| 7 — Avatar experimental | Opcional; pendiente | Prototipo local medido y decisión de viabilidad |
| 8 — Rendimiento y compatibilidad | En proceso; cámara móvil y recuperación del pipeline integradas | Validación física en iPhone y mediciones de tiempo, memoria y calidad |

### Seguimiento de 4A y 4B

La continuidad programada de 4A ya no es una validación pendiente: las siete
ejecuciones diarias del 19 al 25 de octubre de 2026 terminaron correctamente.
El 25 de octubre también se forzó una copia cifrada y se verificó su restauración
en una rama temporal de Neon, incluida la eliminación de esa rama.
Evidencia: [ejecución programada del 25 de octubre](https://github.com/JosueMM01/my-closet/actions/runs/40186987536)
y [copia y restauración verificadas](https://github.com/JosueMM01/my-closet/actions/runs/40228575022).

La política actual revisa el estado diariamente, renueva el acceso a Drive y
solo crea otra copia cuando la última tiene al menos ocho días, salvo ejecución
forzada. Conserva dos generaciones completas. Una ejecución correcta puede
omitir la creación de una copia por estar todavía vigente la anterior; no
significa que exista una copia nueva cada día. Este intervalo puede implicar
varios días de pérdida de cambios ante un incidente.

4A queda lista por aceptación expresa del propietario de esa frecuencia, la
cobertura PostgreSQL y el seguimiento manual mientras no haya monitor
independiente. El propietario mantiene por separado la identidad de descifrado
`age` y asume estas tareas de operación:

- Revisar Actions cada uno o dos días y comprobar que continúan las ejecuciones
  diarias; revisar el resumen de cada copia nueva.
- Comprobar los avisos de fallo de Actions y atender cualquier ejecución fallida.
- Investigar si pasan más de 48 horas sin una ejecución correcta o si la última
  copia completa supera nueve días. Son umbrales de seguimiento propuestos,
  no alertas automáticas ya implementadas ni garantías de ejecución puntual.
- Repetir una restauración aislada periódicamente, por ejemplo trimestralmente,
  y después de cambios importantes en el esquema o el sistema de respaldos.

La alerta independiente de copia atrasada permanece como mejora pendiente; no
se declara implementada al aceptar el seguimiento manual.

4B queda lista por indicación del propietario. Su mantenimiento consiste en
mantener la app OAuth publicada, no revocar inadvertidamente el acceso de Drive,
conservar los permisos necesarios y actualizar los textos públicos si cambia
el servicio. No es necesario renovar preventivamente un token que funciona.
Si Actions informa `invalid_grant`, se debe revisar si expiró o se revocó la
autorización y reautorizar el cliente de respaldos cuando corresponda; no debe
confundirse con el cliente de Google Sign-In de la aplicación.

Publicar la app elimina la restricción de siete días propia del estado Testing
en los casos aplicables; no convierte el refresh token en irrevocable. Google
puede invalidarlo, por ejemplo, por revocación, seis meses sin uso, límites de
tokens o políticas de cuenta. El access token sigue teniendo caducidad y el
workflow obtiene otro mediante el refresh token en cada comprobación.
Referencia: [vigencia de tokens OAuth de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

Los respaldos de PostgreSQL no incluyen binarios Cloudinary ni borradores
IndexedDB. No declarar recuperación completa de imágenes por restaurar la base.
Turnstile tiene claves separadas para Production y Preview. Por instrucción
expresa del propietario, producción tiene `TURNSTILE_ENABLED=true`. Se
reconstruyó el mismo main `4b760a4`, sin rotar claves ni modificar los widgets,
y se comprobó la activación en `my-closet.josuem01.dev`.
Login y recuperación conservan validación de entrada, comprobación de origen
y límites de intentos, además de exigir la verificación de Turnstile.
En recuperación, el servidor rechazó solicitudes sin token y con token inválido
con 403, y aceptó solicitudes con un token real para una dirección sintética
inexistente, sin crear cuentas, sesiones ni enviar correos reales.
El login mantiene Entrar deshabilitado con campos vacíos o sin contraseña y
lo habilita con los campos válidos y el desafío resuelto; Google sigue disponible.
El ensayo específico de reutilización aún no se da por comprobado: el navegador
redacta el token al leerlo mediante automatización. Esta limitación de la prueba
no desactiva Turnstile ni autoriza eludir la protección de lectura del navegador.

El nuevo cambio de correo conserva la dirección actual hasta confirmar un código
de seis dígitos juntos en el correo y seis casillas de entrada con pegado
completo, válido durante diez minutos y anulado tras cinco intentos fallidos.
Las migraciones `0004` y `0005` se ensayaron con el migrador en una copia
aislada y se aplicaron a staging y producción antes de publicar esta entrega.
El propietario acepta el cierre funcional de 5B; esto no habilita la baja de
cuentas ni convierte las comprobaciones adicionales pendientes en pruebas aprobadas.
El Preview de correo y el de develop están autorizados en el widget Turnstile
de Preview y tienen habilitada la verificación. Se comprobó el acceso con un
token real en Preview; su rechazo al reutilizarlo sigue pendiente antes de
afirmar funcionamiento completo. El propietario también informa que el flujo
de Preview se comporta correctamente en el navegador integrado.
Google sigue desactivado en `feat/verified-email-change`, cuyo callback no está
registrado, pero está habilitado en el Preview de `develop` y en producción.
El código de Turnstile ya está en main y su bandera de producción está activa.
Preview conserva su configuración actual. La activación y la solicitud real
del dominio canónico están comprobadas; el ensayo de rechazo de un token real
reutilizado permanece registrado como pendiente, sin confundirlo con la
disponibilidad del servicio. El ensayo adicional se conserva como seguimiento en 6.

La entrega pública directa de Cloudinary se conserva por decisión del propietario,
sin proxy de imágenes por Vercel. No se promete confidencialidad por una URL difícil
de adivinar ni revocación de URLs ya conocidas. La fase 6 debe aclarar esta política
en la experiencia y comprobar la matriz de permisos de datos y compartidos; no
introducir entrega privada ni cambios de coste sin una decisión nueva.

Antes de habilitar 5C, resolver las referencias de invitaciones y copias ajenas,
registrar limpieza Cloudinary durable antes de perder sus claves y proteger al
último administrador. Exigir conexión, reautenticación y confirmación final explícita,
sin sustituir la autenticación por escribir una palabra.
Los dispositivos offline y los respaldos históricos no se borran de inmediato;
la reconexión y la restauración deben impedir reintroducir cuentas eliminadas.
Las pruebas de limpieza no deben borrar recursos de producción referenciados
por una copia de su base: deben utilizar exclusivamente assets sintéticos.

El propietario confirmó conservar las copias ajenas legítimas, respetar la
retención de respaldos y reautenticar con Google a las cuentas sin contraseña.
La implementación local conserva un identificador anonimizado y deshabilitado
para las referencias necesarias; revoca accesos, sesiones, invitaciones y tokens
y protege al último administrador usando el bloqueo transaccional de cupo.
El callback de Google solo entrega una prueba breve, de uso único y ligada a la
sesión, cuenta y credenciales; el modal exige después una confirmación explícita.
La frescura exige `auth_time`: un token recién emitido o elegir una cuenta no basta.

Las pruebas aisladas cubren contraseña incorrecta, origen ajeno, Google distinto
o antiguo, consumo de la prueba, último ADMIN, escrituras tardías, referencias
compartidas, reintentos e idempotencia. El worker solo acepta llamadas autenticadas
y bloquea claves fuera del prefijo autorizado. Su operación real no está habilitada.
La migración aditiva `0006_account_deletion.sql` se aplicó únicamente a la base
vacía `closet_5c_preview`, en una rama Neon de pruebas y con un rol nuevos.
No se aplicó a staging ni producción. Pasaron los 14 contratos PostgreSQL previos
y cinco nuevos de baja: ADMIN concurrentes, escrituras tardías, referencias
compartidas, guardas de imágenes y consumo de la prueba Google simulada.
Esto no sustituye el ensayo con Google real ni la validación del modal en Preview.

Antes de activar, cubrir también las subidas firmadas aún no finalizadas y assets
huérfanos: una firma ya emitida puede sobrevivir a la sesión de la aplicación.
Definir un registro mínimo de bajas independiente de la base restaurada y el
procedimiento de reconciliación y revocación antes de recuperar un respaldo antiguo.
Validar Google real y el modal en móvil/escritorio, incluida pérdida de conexión
después de confirmar el servidor. Estas son condiciones de cierre, no tareas omitibles.
No se habilitan bajas ni se ejecutan borrados de cuentas o imágenes reales durante
esta preparación. Tampoco se promete borrado inmediato de respaldos, cachés CDN
ni de dispositivos offline; el origen actual se limpia tras recargar, antes del sync.

## Orden de entrega

1. Confirmar un respaldo recuperable y verificar el endpoint de producción.
2. Ensayar las migraciones en una copia aislada antes de aplicarlas. Los pasos
   aditivos `0002` y `0003` ya se ensayaron y verificaron en producción.
3. Mantener Production y Preview separados y conservar un despliegue al que volver.
4. Exigir CI del commit que se va a publicar y respetar las protecciones de GitHub.
   Una excepción de administrador requiere autorización expresa del propietario.
5. Publicar con variables de producción y comprobar acceso, sincronización e imágenes.
6. Mantener 5A y 5B cerradas funcionalmente, publicar el endurecimiento de la
   caducidad y completar 5C; después, experiencia y seguimiento (6), avatar
   opcional (7) y rendimiento y compatibilidad, incluido iPhone (8), sin
   reclasificarlos como completos por aprobar CI.

## Trabajo y documentación

Una unidad lógica por rama desde `develop`, commits Conventional Commits,
integración a `develop` y entrega revisada hacia `main`. Push, PR y publicación
requieren autorización del propietario; un push puede generar un Preview.

Solo se versionan estos documentos en `docs/`:

- [PHASES.md](PHASES.md): estado de las fases y criterios de entrega.
- [ARCHITECTURE.md](ARCHITECTURE.md): capas, flujos y límites.
- [STACK.md](STACK.md): tecnologías, entornos, herramientas y licencias.

Los apuntes operativos y evidencias de trabajo se conservan localmente mediante
la lista de exclusión de Git. No guardar secretos en documentos, Git o logs.
