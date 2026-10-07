# Ruta de mejora de My Closet

Revisión: 2026-10-04. Este es el plan versionado del nuevo ciclo. No reinicia
funcionalidades ni renumera el historial; `PHASES.md` sigue como bitácora local,
ignorada por Git. No contiene credenciales.

## Punto de partida

- El propietario reporta app desplegada, login, correo y armario funcionales.
  No equivale a certificar todos los casos de permisos o sincronización.
- Conservar las fases anteriores y sus evidencias históricas. No presentar cifras
  antiguas de tests como validación de esta revisión.
- Pipeline adaptativo confirmado por el propietario en Xiaomi 12 y Galaxy A35;
  tiempo reportado de 35–45 s. Optimización pendiente, no funcionalidad básica.
- PR #7 de respaldos fusionado directamente a main el 2026-10-04; develop aún
  no lo contiene en remoto. La rama local fix/backup-recovery-phase-4a, creada
  desde develop, integra el baseline publicado y las correcciones posteriores.
  Copia/restauración/rotación demostradas el 4 de octubre; scheduler pendiente.
- PR #8 de limpieza cerrado sin fusionar por solicitud del propietario. La rama
  Su eliminación de 16 documentos y referencias ya está integrada en la rama 4A.
  No volver a abrirlo, publicar ramas o generar previews sin confirmación expresa.
- PR #10 confirmado fusionado en main. El propietario reporta callback de
  develop registrado y cliente OAuth de respaldos publicado. Quedan por
  comprobar renovación posterior al cambio, scheduler y alertas en operación.
- En `feat/security-account-lifecycle-performance`: recuperación de sesión con
  identidad local preservada; límites compartidos implementados; carpetas por
  generación de respaldo implementadas. No equivale a publicación de 5B/5C/6.

## Integración y criterios generales

- Una unidad lógica por rama `feat/`, `fix/` o `chore/` desde develop; commits
  atómicos → PR a develop → validación → PR de lanzamiento a main.
- Preparar y probar localmente antes de pedir autorización para push y PR.
  Un push puede generar preview aunque no haya PR. Agrupar commits de una entrega
  revisable; no juntar todas las fases en un único PR ni asumir un build por fase.
- Preview usa Neon staging o rama temporal; producción usa Neon main. Verificar
  proyecto, rama y endpoint antes de migrar: la rama Git no selecciona Neon.
- Migraciones compatibles, rollback explícito y ningún cambio destructivo sin
  autorización. Push, merge y acciones reales de servicios requieren autorización.
- UI desde IndexedDB, Zod en boundaries, imágenes procesadas en navegador;
  secretos fuera de Git/logs y tokens fuera del almacenamiento del navegador.
- Pruebas proporcionales al riesgo. Una auditoría grave tiene prioridad sobre la
  numeración. CI verde no demuestra recuperación ni seguridad completa.
- Evitar builds de Vercel por cambios solo de docs/respaldos cuando se configure
  una exclusión segura; no desactivar checks obligatorios sin revisar integración.
- Registrar evidencias con fecha, entorno, commit y resultado. Distinguir
  implementado, integrado, desplegado y validado en operación.

## Fases del ciclo de mejora

| Fase | Estado inicial | Criterio de cierre |
|---|---|---|
| 4A — Recuperación operativa | Recuperación y rotación demostradas; integración remota/scheduler pendientes | Correcciones publicadas, run Actions y ejecución programada comprobados |
| 4B — Publicación OAuth | Páginas/diagnóstico locales; contacto aprobado; publicación pendiente | Páginas públicas y renovación de Drive comprobadas, con alertas |
| 5 — Seguridad e identidad | Alta; auditoría y cambios pendientes | Permisos/aislamiento demostrados y hallazgos graves resueltos |
| 6 — Rendimiento y recursos | Pendiente | Tiempo y peso medidos sin regresión móvil/offline |
| 7 — Experiencia y documentación | Documentación inicial en curso | UX coherente y documentos vigentes sin referencias obsoletas |
| 8 — Avatar experimental | Opcional | Prototipo local medido y decisión de viabilidad |

La antigua fase 7 de compatibilidad móvil se conserva como historial cerrado;
la fase 7 de esta tabla corresponde al nuevo ciclo.

### 4A — Terminar la recuperación existente

- Antes de publicar: medir assets generados y preparar control de previews para
  cambios de docs/respaldos. Este adelanto de 6 es una puerta de publicación,
  no una reescritura del pipeline ni una nueva fase numerada.
- Regularizar la divergencia main/develop tras PR #7 mediante integración revisada;
  llevar las tres correcciones locales pendientes sin duplicar cambios. No se puede
  cambiar la base del PR ya fusionado. No mezclar avatar o UI en esta entrega.
- Validar y publicar la corrección local del workflow después de revisar CI y
  builds de Vercel. Confirmar Secrets/Variables sin imprimir valores.
- Avance 2026-10-04: herramientas alineadas con PostgreSQL 18 de Neon; comprobación
  de major antes del dump y timeout predeterminado de Neon Free. 35 tests dirigidos,
  TypeScript, lint y actionlint correctos. Ensayo real recuperó 11 tablas, conservó
  dos generaciones y omitió nueva copia dentro del intervalo. Evidencia en
  [BACKUP_RECOVERY_EVIDENCE.md](BACKUP_RECOVERY_EVIDENCE.md).
- Verificar destino de producción, acceso a Drive y custodia externa de age.
- Ensayar copia forzada y restauración solo en Neon temporal; comprobar tablas,
  relaciones, checksums y limpieza de la rama creada.
- Crear tres generaciones y demostrar que quedan las dos últimas completas;
  ejecutar sin forzar para comprobar el intervalo de ocho días.
- Comprobar una ejecución programada real y alertas de fallo/copia atrasada,
  incluyendo el caso en que el workflow deje de dispararse.
- El dump no contiene binarios Cloudinary ni borradores IndexedDB. Documentar
  cobertura y recuperación de imágenes antes de afirmar recuperación completa.

Cierre: copia recuperable, rotación segura, scheduler comprobado y procedimiento
reproducible. No bloquear la app durante el dump ni restaurar automáticamente en
producción. Detalles: [BACKUPS.md](BACKUPS.md).

### 4B — Publicación y continuidad de OAuth

- Avance local del 4 de octubre en `feat/public-policies-drive-phase-4b`, creada
  desde develop e integrada con las correcciones locales de 4A: `/about`,
  `/privacy`, `/terms`, enlaces desde acceso/registro y separación del runtime
  privado. Diagnóstico OAuth acotado, sin tocar Drive tras rechazo de renovación.
  Responsable/contacto aprobados: Josue Martinez y contacto@josuem01.dev;
  defaults públicos versionados, sin derivarlos de credenciales privadas.
  Procedimiento y checklist: [OAUTH_PUBLICATION.md](OAUTH_PUBLICATION.md).
- Crear presentación pública y rutas propuestas `/privacy` y `/terms`, sin login,
  enlazadas desde el acceso. Describir datos, cookies, servicios, almacenamiento
  local, respaldo, retención, borrado y contacto reales. Revisión del propietario;
  el texto no constituye una certificación legal.
- Mantener clientes/proyectos Google Sign-In y Drive separados. Revisar dominio,
  URLs y permisos mínimos; completar publicación/verificación según Google.
- Obtener autorización offline nueva después del cambio de estado, actualizar el
  Secret autorizado y demostrar renovación y copia real.
- No prometer token permanente: tratar revocación/`invalid_grant` sin borrar
  copias existentes, alertar y documentar reautorización.

Cierre: páginas públicas verificadas, configuración revisada y renovación/alertas
probadas. Testing permite un ensayo puntual de 4A, no demuestra continuidad.

### 5 — Seguridad e identidad

Checkpoint local: contador compartido con migración aditiva `0003`, límites de
autenticación, invitaciones, imágenes y sync; guardas 429/503, HMAC y arranque de
BD único por proceso. La migración se aplicó exclusivamente en Neon staging tras
verificar el endpoint mediante API. No aplicada en producción. Falta completar
el inventario de rutas, verificar nuevo correo y privacidad Cloudinary; 5C y la
optimización móvil de 6 siguen pendientes. No habilitar borrado de cuentas antes
de probar referencias compartidas, trabajos durables y recuperación.

Evidencia de este checkpoint: suite local completa, TypeScript y lint correctos;
27 pruebas dirigidas de respaldos; cuatro contratos PostgreSQL ejecutados en
Neon staging, incluido cupo exacto 5/30 entre dos conexiones independientes;
build local de producción correcto con SQLite y proveedores simulados. No se
generó deployment ni PR. La nueva organización de carpetas aún no se ejecutó
contra Google. Antes del siguiente release aplicar migración en producción tras
backup/verificación; el código nuevo sin tabla devolvería 503.

Decisión del propietario, 2026-10-05: mantener entrega pública desde Cloudinary,
sin proxy Vercel ni firmas de entrega. No son imágenes privadas; también afecta
fotografías de perfil. La firma de subida y finalize siguen protegiendo las
credenciales y la asignación de propietario. Esta decisión sustituye el requisito
anterior de entrega privada; no cambia permisos de escritura ni datos del armario.

- 5A ampliada localmente en `fix/admin-invitation-seat-reservations-phase-5a`, creada
  desde develop e integrada por fast-forward con las dependencias 4A/4B pendientes.
  Política aprobada: activos + invitaciones ADMIN pendientes y vigentes <= 2.
  Una invitación reserva plaza hasta aceptarse, revocarse o caducar; USER no reserva.
  Emisión, promociones y reactivaciones respetan reservas. Contraseña/Google
  consumen su propia reserva sin contarla dos veces. PostgreSQL serializa estos
  escritores con bloqueo transaccional antes de bloquear filas; SQLite usa transacciones.
  UI indica plazas reservadas, cómo liberarlas y actualiza caducidad sin recargar.
  No cambia esquema ni debilita adminSlot. Si hay invitaciones antiguas
  sobreasignadas, el propietario debe revocar las sobrantes; no se revocan automáticamente.
  SQLite y contratos PostgreSQL reales con tablas temporales probados; revisión
  manual e integración pendientes. Véase [VALIDATION_CHECKLIST.md](VALIDATION_CHECKLIST.md).
- Auditar autorización server-side por operación, usuario y propietario en sync,
  imágenes, shares y administración; probar rutas/IDs ajenos con dos usuarios.
- Revisar SQL parametrizado, Zod, asignación masiva, XSS/CSP, CSRF/origen, CORS,
  redirects, OAuth, cookies, expiración y revocación. CORS no sustituye permisos.
- Implementar límites compartidos compatibles con costo cero; separar login,
  recuperación, invitaciones, OAuth, sync y subidas. Medir coste y limpieza.
- Reautenticar conservando IndexedDB/outbox y reanudar solo para la identidad
  correcta. Separar recuperación de sesión, logout y cambio de cuenta.
- Verificar el nuevo correo y probar invitaciones de un uso y vinculación segura.
- Revisar secretos/dependencias y diagnósticos sin datos sensibles. Passkeys se
  diseñan como subfase con recuperación; no guardar biometría.
- 5B: límites compartidos, recuperación de sesión y verificación del nuevo correo.
  Entrega Cloudinary pública aprobada; conservar advertencia en privacidad y
  prohibición de fotos sensibles. Probar ownership de subida/finalize, imágenes
  de perfil, clones y operación offline; no afirmar que revocar un share oculta
  URLs de imagen ya conocidas. No migrar imágenes a privadas.
  Checkpoint adicional: cuotas por usuario para contraseña/correo (5/min),
  actualización de perfil (30/min) y desvinculación Google (5/min).
- 5C: diseñar baja voluntaria después de validar recuperación y permisos. Requerir
  conexión, identidad/reautenticación reciente y palabra ELIMINAR validada también
  por servidor, con explicación de datos, imágenes y nueva invitación necesaria.
  Proteger al último administrador y revocar sesiones, identidades OAuth, enlaces
  y operaciones posteriores antes de iniciar la eliminación.
  Registrar trabajo durable e idempotente de limpieza Cloudinary antes de borrar
  los storageKey en Neon: no existe una transacción común Neon/Cloudinary. No
  prometer éxito completo si la nube falla; reintentar con trazabilidad sanitizada.
  Resolver FKs account_invitations.createdBy/acceptedBy (sin cascade), referencias
  de clones/shares y política de copias ajenas antes de borrar imágenes. No eliminar
  recursos de otros usuarios; decidir cómo conservar copias independientes.
  Limpiar IndexedDB/outbox y cachés de la cuenta en el dispositivo actual; otros
  dispositivos offline requieren purga al reconectar y nunca deben reinsertar datos.
  Documentar retención en los dos respaldos, impedir resurrección al restaurar y
  no afirmar borrado inmediato de copias offline o respaldos históricos.

Cierre: pruebas negativas y regresiones críticas cubiertas, hallazgos graves
resueltos. No prometer inmunidad a todos los ataques.

### 6 — Rendimiento y recursos

Avance 2026-10-05: móviles sin historial priorizan CPU/quint8 antes de FP16,
sin basarse únicamente en RAM. Se conserva una ruta exitosa anterior y se omiten
rutas que fallaron dos veces; escritorio y guardas WebGPU Android no cambian.
No se retiraron modelos ni se certifica reducción de tiempo sin comparación
física en Xiaomi/A35. Actualización local del 6 de octubre: un único control de
foto abre un modal con cámara propia (getUserMedia, sin audio) y acceso a galería.
Captura limitada a 1080 px, liberación al cerrar/salir y ante permisos tardíos;
se conserva el procesamiento local y no se suben borradores antes de guardar.
Build, TypeScript, lint y seis casos E2E dirigidos móvil/escritorio aprobados con
cámara simulada. Pendiente publicar y validar físicamente en Xiaomi/Samsung;
el Preview actual del PR #11 todavía no incluye esta actualización.

- Medir caché fría/caliente: descarga, runtime, preparación, inferencia y
  codificación en Xiaomi, Samsung y escritorio, sin conservar fotos ni EXIF.
- Comparar Pixel Crunch (IMG.LY 1.7.0; móvil CPU/quint8 y escritorio GPU/FP16).
  Revisar licencia antes de reutilizar código. No asumir que su política es más
  rápida sin medir calidad y estabilidad con las mismas entradas.
- Hallazgo del 2026-10-04: sus 25 MiB son límite por archivo de Cloudflare, no el
  tamaño del modelo completo. Ambos repos usan isnet 168.0 MiB, FP16 84.1 MiB y
  quint8 42.3 MiB, en chunks de hasta 4 MiB; runtimes WASM 11.3/21.9 MiB.
  Pixel Crunch prioriza quint8 en móviles; My Closet prioriza FP16 si no detecta
  limitación y usa isnet completo en GPU permitida. Comparar mismas entradas y
  caché fría/caliente. Ambos terminan Worker por intento: caché no conserva sesión ONNX.
- Evaluar quint8 primero en móvil, FP16 en GPU estable y necesidad del modelo
  completo. Conservar liberación de Worker, fallback manual y caché tolerante.
- Revisar retención, peso de assets y builds innecesarios. Hosting separado de
  modelos exige integridad, CORS y validación offline.
- Medir compresión/reintentos y borrado con referencias; llevar presupuesto de
  uso de Vercel, Neon y Cloudinary. Gratis no significa recursos ilimitados.
- Incluir presupuesto separado de Deployment Storage (GB-mes), Fast Data Transfer,
  Fast Origin Transfer y builds. Evaluar retirar isnet completo solo tras demostrar
  calidad/fallback con FP16/quint8; no borrar modelos por tamaño sin pruebas móviles.
- Revisar precache de detalles offline (hasta 500 rutas), polling, pull paginado,
  reintentos y bytes de imágenes. Ya hay WebP 1080 px/calidad 0.82 y deduplicación
  de upload en vuelo; no asumir que compresión o deduplicación resuelven todo el uso.

Puerta de publicación adelantada en 4A: `vercel.json` preparado localmente omite
autodeployment de las dos ramas de respaldo/limpieza concretas, no todas las
ramas. Ignored Build Step compara contra VERCEL_GIT_PREVIOUS_SHA (último deployment
exitoso de la rama), no contra HEAD^. Solo omite docs y respaldos independientes;
cambios de app/configuración, historial ausente o base inválida construyen.
No está activado en remoto todavía. En un primer deployment de rama o cambio
de configuración puede ser necesario un build: no prometer omisión universal.

Consumo observado 2026-10-04 en Vercel, equipo Hobby, vista últimos 30 días:
Deployment Storage 1,79/10 GB; Fast Data Transfer 54,95 MB/100 GB;
Fast Origin Transfer 47,33 MB/10 GB. Aproximadamente 8,21 GB libres en storage,
según la lectura redondeada. Storage no es transferencia ni un contador de builds:
cada deployment retenido, también previews, ocupa espacio. No se generaron
builds/deployments en este ensayo ni se borraron deployments existentes.

Cierre: comparación antes/después y límites acordados, sin regresiones móviles.

### 7 — Experiencia y documentación

- Añadir icono oficial Google con guía de marca y accesibilidad.
- Adelanto local de acceso: botón «Iniciar sesión con Google», candado visible y
  errores por causas comprobadas (cuenta activa vinculada no encontrada,
  cancelación, flujo inválido y conflictos de invitación/vínculo). No afirmar que
  un correo no existe si simplemente falta vínculo o activación; no mostrar
  errores arbitrarios ni vincular automáticamente por coincidencia de correo.
- 7A: centralizar avisos en una región fija visible, con safe areas, contraste,
  `aria-live`, cola/deduplicación y cierre. Éxitos breves pueden expirar; errores
  críticos permanecen y enlazan al campo/acción. Validar sin scroll, con teclado,
  modal, offline y viewport móvil. No requiere permisos del sistema ni Push;
  conservar errores junto a los campos y el mensaje del login.
- 7B opcional: evaluar Web Push para eventos útiles con app cerrada (por ejemplo
  recordatorios del calendario), no cada error de formulario. Requiere permiso
  voluntario, suscripciones aisladas por usuario, VAPID, bajas, expiración y
  política de contenido/horarios. Definir casos y presupuesto antes de añadir
  backend o scheduler; no pedir permisos ni enviar notificaciones en esta entrega.
- Alinear mensajes de progreso, errores y sincronización con la etapa real.
- Integrar la limpieza ya preparada en chore/remove-legacy-docs: retirar decisions,
  local-prs y reference por decisión explícita del propietario y eliminar enlaces
  restantes. Se conservan solo en el historial Git, no como guía del proyecto.
  La limpieza no necesita preview funcional propio; incluirla en la próxima entrega
  documental compatible autorizada. ROADMAP, estado y documentos técnicos vigentes
  describen exclusivamente My Closet y se actualizan con evidencias reales.
- Actualizar arquitectura, servicios, autenticación, imágenes y seguridad.

Cierre: recorridos dirigidos aprobados y referencias coherentes.

### 8 — Avatar experimental

- Verificar primero la referencia visual: el reel solicitado no pudo visualizarse
  en la revisión inicial.
- Empezar por avatar/silueta 2D y composición local de prendas con escala,
  posición y capas. No simula talla, caída ni ajuste real.
- Evaluar 3D/prueba virtual realista aparte, sin prometer inferencia gratuita ni
  comprometer privacidad y compatibilidad móvil.

Cierre: decisión de viabilidad y prototipo medido; no bloquea el uso personal.

## Siguiente unidad

Publicación de 4A solo con confirmación. Recuperación local ya demostrada; registrar
el run manual/programado hospedado y notificaciones pendientes. Preparar 4B sin
publicar anticipadamente y evitar otra entrega de modelos para estos cambios.
Orden funcional conservado: 4A → 4B → 5A/5B/5C → 6 → 7 → 8. La medición inicial
de 6 y actualización documental de 7 son transversales, no bloquean el plan.
Entrega autorizada el 5 de octubre: 4A/4B/5A integrada a develop mediante PR #9;
PR #10 abierto de develop a main para revisión, sin merge automático.
La siguiente entrega agrupa 5B/5C/6 en
`feat/security-account-lifecycle-performance`, creada desde develop actualizado.
Compartir PR/despliegue no mezcla sus puertas: commits y pruebas independientes;
la baja irreversible 5C exige validación específica de referencias y limpieza durable.
PR funcional no equivale a deployment por commit: preparar entrega completa,
autorizar publicación una sola vez y revisar el presupuesto antes de cada release.
Preview de develop verificado READY para 4d0e439, con DATABASE_URL y conexión
directa exclusivas de Neon staging, AUTH_SECRET independiente y URL de Preview.
Los valores de producción no se modificaron. Cloudinary todavía comparte recursos;
no efectuar migración/borrado destructivo de imágenes para probar 5B.
Google Cloud debe autorizar el callback del dominio Preview antes de probar OAuth.
La baja de cuenta y el conjunto de 5B siguen pendientes; no clasificar el lote como cerrado.

Inicio local de 5B validado: recuperación de sesión con perfil/outbox conservados, bloqueo
del reemplazo silencioso de identidad y cambio explícito de cuenta para aceptar
invitaciones. El token permanece solo en memoria y se retira del fragmento; se
conserva entre repeticiones del efecto en Strict Mode. La rama de trabajo no
genera autodeploy; consolidar el lote antes de publicar, no abrir otro PR funcional
por cada commit. Continuar con límites compartidos, verificación de correo y
privacidad Cloudinary, después baja durable y mediciones del pipeline.
Validación de este primer bloque: 63 tests dirigidos unitarios/integración,
ocho E2E de móvil/escritorio sobre localhost con APIs interceptadas, TypeScript,
ESLint dirigido y diff sin errores. OAuth en E2E simula el retorno y la sesión;
no demuestra interacción real con Google. Sin migraciones, borrados Cloudinary
ni nuevo deployment del bloque 5B. CI del PR #10 también aprobado.

Checkpoint 2026-10-05: decisión de entrega pública registrada; botones de cámara
y galería integrados; modelo ligero como default en móviles nuevos, preservando
historial exitoso. Build local correcto, 255 pruebas de la suite aprobadas y
pruebas adicionales de límites de perfil correctas, junto con lint/TypeScript.
La ejecución E2E nueva no pudo arrancar su servidor aislado por restricción del
entorno: no está validada ni certifica cámara física. Vercel Development quedó
aislado; Preview conserva URL de develop y las claves staging ya separadas;
metadatos de todas las variables Production permanecieron sin cambios. No se
publicó código ni generó deployment. 5B mantiene pendiente verificación del
nuevo correo e inventario de permisos; 5C mantiene pendiente implementación de
baja durable; 6 requiere medición/aceptación física de rendimiento y calidad.

### Puerta de entrega revisada — 2026-10-05

- Bloque técnico de límites compartidos de 5B terminado y revalidado: 59 pruebas
  dirigidas de contadores, autenticación, respaldos y pipeline aprobadas. El cierre
  es de implementación local, no de toda 5B ni de validación en producción.
- Git remoto y Vercel coinciden: main `2a2dddb` y develop `4d0e439`, ambos con
  deployments READY. La rama de trabajo conserva cambios posteriores no publicados.
- Preview tiene variables de conexión y sesión separadas de Production; Google,
  SMTP y Cloudinary todavía comparten configuración. No promover el artefacto
  Preview a Production con credenciales staging: producir un build de main con
  variables de producción.
- La rama de trabajo tiene autodeploy desactivado. Un push autorizado puede guardar
  avances sin crear Preview; el Preview de develop requiere integrar el código.
  Objetivo de la siguiente entrega: un Preview de develop y una publicación de main,
  sin deployments por cada commit. CI y la validación específica siguen obligatorios.
- Antes de publicar los límites en main, confirmar respaldo y aplicar/verificar la
  migración aditiva `0003_shared_rate_limits.sql` en producción. Sin la tabla,
  los endpoints protegidos fallan de forma cerrada con 503.
- Consumo Vercel actual no confirmado: el conector de cargos respondió
  `costs_not_found` y el navegador requiere autenticación. Los 1,79 GB anteriores
  son una referencia histórica, no una medición actual. El directorio public local
  mide 648.227.940 bytes; no equivale a tamaño facturado por deployment ni incluye
  los bundles de Functions. Revisar ambas métricas en Usage antes de autorizar build.
- No declarar cerradas 4A/4B por un merge: falta comprobar continuidad programada
  y renovación OAuth. Tampoco cerrar 5B/5C/6 antes de completar sus puertas propias.

Checkpoint histórico de 4A (2026-09-30, anterior al ensayo del 4 de octubre): renovación OAuth y listado Drive reales
correctos, destino Neon confirmado por API y configuración Actions registrada.
Workflow validado con actionlint; 13 tests dirigidos, TypeScript y lint correctos.
Guardas de retención/carga/restauración reforzadas. No se ejecutó copia ni
restauración real; publicación/integración y scheduler siguen pendientes. Evidencia
y siguiente ensayo en [BACKUPS.md](BACKUPS.md).

## Referencias

- [GitHub Actions: scheduler y limitaciones](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- [Publicación OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
- [Vigencia de refresh tokens](https://developers.google.com/identity/protocols/oauth2).
- [Marca del botón Google](https://developers.google.com/identity/branding-guidelines).
- [Pipeline Pixel Crunch](https://github.com/JosueMM01/pixel-crunch/blob/main/docs/BACKGROUND_REMOVAL.md).
