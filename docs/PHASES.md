# Fases de My Closet

Actualización: 2026-10-18. Este archivo conserva el plan público del proyecto.
La implementación, la integración, la publicación y la validación en uso son
estados distintos; aprobar CI no cierra por sí solo una fase.

## Base funcional integrada

La aplicación incluye armario, conjuntos, sugerencias locales y calendario;
sesión, Google Sign-In, registro por invitación y administración; sincronización
offline-first, PostgreSQL y almacenamiento remoto de imágenes. Las sugerencias
son deterministas y locales, sin llamadas a modelos de lenguaje.

## Ciclo de mejora vigente

| Fase | Estado | Pendiente para cerrar |
|---|---|---|
| 4A — Respaldos y recuperación | Copia cifrada, retención de dos generaciones y restauración aislada verificadas en Actions | Confirmar continuidad programada y alertas de copia atrasada |
| 4B — Publicación OAuth | Páginas de presentación, privacidad y términos publicadas; cliente de respaldos en producción; renovación comprobada | Mantener comprobaciones de renovación, permisos y alertas |
| 5A — Invitaciones y cupo ADMIN | Reservas transaccionales integradas: activos más invitaciones ADMIN vigentes no superan dos | Completar la aceptación manual de los flujos relevantes |
| 5B — Seguridad e identidad | Recuperación de sesión, límites compartidos y guardas publicados; verificación del nuevo correo implementada en rama separada | Validar CI/PostgreSQL y entrega SMTP del nuevo flujo, ensayar su migración antes de publicarla; revisión de permisos y privacidad de imágenes; activar y validar Turnstile real |
| 5C — Baja de cuentas | Pendiente | Reautenticación, confirmación, revocación de sesiones y borrado durable con referencias compartidas y respaldos |
| 6 — Rendimiento y compatibilidad | Cámara móvil y recuperación del pipeline integradas | Validación física en iPhone y mediciones de tiempo, memoria y calidad |
| 7 — Experiencia y documentación | Documentación pública reducida a fases, arquitectura y stack | Coherencia de mensajes, avisos y revisión de experiencia; Web Push se evalúa aparte |
| 8 — Avatar experimental | Opcional | Prototipo local medido y decisión de viabilidad |

Los respaldos de PostgreSQL no incluyen binarios Cloudinary ni borradores
IndexedDB. No declarar recuperación completa de imágenes por restaurar la base.
Turnstile tiene claves separadas para Production y Preview; producción permanece
desactivada hasta comprobar el flujo real del dominio canónico.

El nuevo cambio de correo conserva la dirección actual hasta confirmar un código
de un solo uso. Su migración `0004` está generada, no aplicada a producción;
este avance no cierra 5B ni inicia la eliminación de cuentas de 5C.

## Orden de entrega

1. Confirmar un respaldo recuperable y verificar el endpoint de producción.
2. Ensayar las migraciones en una copia aislada antes de aplicarlas. Los pasos
   aditivos `0002` y `0003` ya se ensayaron y verificaron en producción.
3. Mantener Production y Preview separados y conservar un despliegue al que volver.
4. Exigir CI del commit que se va a publicar y respetar las protecciones de GitHub.
   Una excepción de administrador requiere autorización expresa del propietario.
5. Publicar con variables de producción y comprobar acceso, sincronización e imágenes.
6. Continuar con los pendientes de 5B, 5C e iPhone sin reclasificarlos como completos.

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
