# PR-004 — UI Soft Editorial + auth + wardrobe

**Rama**: `feat/auth-client` → `development`

## Cambios
- Design system: tokens Tailwind 4 (paleta #F8F5F2/#B05C78…), Fraunces +
  Manrope self-hosted, utilitarias card-surface/safe-area/no-scrollbar.
- Kit UI accesible: Button/Field/Chip/EmptyState/Modal/Confirm/SyncBadge
  (touch targets ≥44px, focus visible, aria).
- Login/registro con proveedor Google desactivado sin env.
- Shell (app): header con avatar+badge, dock inferior 3 tabs, FAB.
- Wardrobe: grid con búsqueda, filtros apilables (categoría/color/talla/
  marca/archivadas), detalle con acciones (editar/clonar/archivar/
  eliminar/compartir), formulario con foto y chips de color.
- Home con saludo, estadísticas y próximos outfits.

## Revisión
- Build ✅ · typecheck ✅ · revisión de contraste y spacing contra
  UI-Reference (login/home/add-garment analizadas).
