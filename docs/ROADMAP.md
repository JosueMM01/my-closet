# Ruta de mejora de My Closet

Revisión: 2026-09-30. Este es el plan versionado del nuevo ciclo. No reinicia
funcionalidades ni renumera el historial; `PHASES.md` sigue como bitácora local,
ignorada por Git. No contiene credenciales.

## Punto de partida

- El propietario reporta app desplegada, login, correo y armario funcionales.
  No equivale a certificar todos los casos de permisos o sincronización.
- Conservar las fases anteriores y sus evidencias históricas. No presentar cifras
  antiguas de tests como validación de esta revisión.
- Pipeline adaptativo confirmado por el propietario en Xiaomi 12 y Galaxy A35;
  tiempo reportado de 35–45 s. Optimización pendiente, no funcionalidad básica.
- Respaldos implementados en la rama de fase 4, pero cierre operativo pendiente.
- Reautenticación de Perfil solo navega al login, que puede redirigir por el
  perfil local persistido. Rate limiting todavía en memoria.

## Integración y criterios generales

- Una unidad lógica por rama `feat/`, `fix/` o `chore/` desde develop; commits
  atómicos → PR a develop → validación → PR de lanzamiento a main.
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
| 4A — Recuperación operativa | Actual; código existente, ensayo pendiente | Copia restaurada, rotación y ejecución programada comprobadas |
| 4B — Publicación OAuth | Siguiente; pendiente | Páginas públicas y renovación de Drive comprobadas, con alertas |
| 5 — Seguridad e identidad | Alta; auditoría y cambios pendientes | Permisos/aislamiento demostrados y hallazgos graves resueltos |
| 6 — Rendimiento y recursos | Pendiente | Tiempo y peso medidos sin regresión móvil/offline |
| 7 — Experiencia y documentación | Documentación inicial en curso | UX coherente y documentos vigentes sin referencias obsoletas |
| 8 — Avatar experimental | Opcional | Prototipo local medido y decisión de viabilidad |

La antigua fase 7 de compatibilidad móvil se conserva como historial cerrado;
la fase 7 de esta tabla corresponde al nuevo ciclo.

### 4A — Terminar la recuperación existente

- Mantener el alcance del PR de respaldos; reencauzar su base a develop con
  autorización. No mezclar avatar, UI ni auditoría general en ese PR.
- Validar y publicar la corrección local del workflow después de revisar CI y
  builds de Vercel. Confirmar Secrets/Variables sin imprimir valores.
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

Cierre: pruebas negativas y regresiones críticas cubiertas, hallazgos graves
resueltos. No prometer inmunidad a todos los ataques.

### 6 — Rendimiento y recursos

- Medir caché fría/caliente: descarga, runtime, preparación, inferencia y
  codificación en Xiaomi, Samsung y escritorio, sin conservar fotos ni EXIF.
- Comparar Pixel Crunch (IMG.LY 1.7.0; móvil CPU/quint8 y escritorio GPU/FP16).
  Revisar licencia antes de reutilizar código. No asumir que su política es más
  rápida sin medir calidad y estabilidad con las mismas entradas.
- Evaluar quint8 primero en móvil, FP16 en GPU estable y necesidad del modelo
  completo. Conservar liberación de Worker, fallback manual y caché tolerante.
- Revisar retención, peso de assets y builds innecesarios. Hosting separado de
  modelos exige integridad, CORS y validación offline.
- Medir compresión/reintentos y borrado con referencias; llevar presupuesto de
  uso de Vercel, Neon y Cloudinary. Gratis no significa recursos ilimitados.

Cierre: comparación antes/después y límites acordados, sin regresiones móviles.

### 7 — Experiencia y documentación

- Añadir icono oficial Google con guía de marca y accesibilidad.
- Alinear mensajes de progreso, errores y sincronización con la etapa real.
- Clasificar docs como vigentes, actualizables o históricos. Retirar `local-prs`
  en un PR separado con referencias de README, AGENTS y DEVELOPMENT; conservar
  decisiones relevantes. No borrar documentación por antigüedad solamente.
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

Continuar 4A: workflow, integración por develop y ensayo autorizado de copia y
restauración. Preparar 4B en una rama independiente. Esta actualización de docs
no ejecutó copias, renovó tokens ni modificó servicios.

Checkpoint posterior de 4A (2026-09-30): renovación OAuth y listado Drive reales
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
