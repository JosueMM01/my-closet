# PR-005 — Outfits, calendario, sharing, perfil y PWA

**Rama**: `feat/outfits` → `development`

## Cambios
- Outfits: lista, builder por categorías (‹ › ciclar, reordenar, filas
  custom), detalle con edición inline y alternado de prendas.
- Calendario: semana lun–dom navegable, mini-mes, entradas con stack de
  miniaturas, marcar vestido, quitar, historial.
- Sharing: invitaciones VIEW/MANAGE con token + copiar enlace, cambio de
  permiso, revocación; página pública /share/[type]/[id].
- Perfil: contadores, estado de sync, banner de sesión expirada, logout
  conservando datos.
- PWA: manifest completo (shortcuts, maskable), iconos generados (sharp),
  SW v2 (precache shell, estrategias, actualización controlada,
  Background Sync), registro con evitación de reload en primera instalación.

## Revisión
- Build/lint/typecheck ✅ · navegación revisada en móvil 360px y desktop.
