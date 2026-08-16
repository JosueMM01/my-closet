# Inventario funcional de Libre Closet (referencia)

> Fuente: análisis web del repositorio https://github.com/lazztech/libre-closet (v0.5.0, jun 2026).
> Propósito: referencia funcional y de dominio para My Closet. **No** se copia código original.

## Stack original (solo contexto)

NestJS 11 + Fastify, HTMX + hyperscript + Handlebars, Tailwind 4 + daisyUI, MikroORM 6 (SQLite/PostgreSQL), JWT en cookie httpOnly, sharp + @imgly/background-removal (ONNX en navegador), Workbox 7 (PWA), web-push, i18n (6 idiomas), Jest + Playwright.

## Entidades y relaciones

- **Garment**: id, name?, category (string, requerido, admite custom), color? (multi → string), brand?, size?, notes?, washingDetails?, dateAquired?, archived (bool), photo → File (1:1), owner → User (N:1), M:N con Outfit.
- **Outfit**: id, name?, notes?, slots (JSON: `[{ category, garmentId }]` preserva orden y duplicados), garments M:N Garment, owner → User.
- **OutfitCalendar**: id, date, outfit → Outfit (N:1 requerido), owner, wornAt? (null hasta marcar "worn"), notes?.
- **User**: id, firstName?, lastName?, email unique, password (hash); 1:N garments/outfits/files/devices.
- **WardrobeShare**: id, grantor → User, grantee? → User (null = pendiente), permission (`VIEW` | `MANAGE`), inviteToken unique, acceptedAt?, createdAt. Unique(grantor, grantee).
- **File**: fileName unique, mimetype?, createdBy → User. Variantes con/sin fondo (`/file/{name}`, `/file/nobg/{name}`).
- **ShareableId** (UUID público) en Garment/Outfit/User/File para enlaces públicos de compartir.

## Funcionalidades

### Wardrobe
- Grid de tarjetas (foto sin fondo o placeholder, nombre, categoría; archivadas con opacidad reducida; contador de resultados).
- Filtros: keyword (LIKE name/notes/brand), category/color/size exactos, archived (excluidos por defecto); pills removibles; filtros disponibles deducidos del contenido.
- Formulario: name, category (datalist = enum + custom existentes, requerido), brand, colores multi-select con swatches y "CREATE", size (normaliza alias `2xl`→`XX-Large`, canónicas XX-Small…5X-Large), washingDetails, dateAquired, notes.
- Acciones: edit (partial updates), clone (reutiliza foto copiándola, "name (cloned)"), archive (toggle, solo owner), delete (solo owner).
- Foto se sube desde el detalle: input file, toggle background-removal (ONNX en cliente, persistido en localStorage), editor de máscara con pincel, hasta 2 archivos.

### Outfits
- Builder por filas de categoría (orden enum primero, custom alfabético, o el orden guardado en slots con duplicados): drag-handle para reordenar, flechas ‹ › que ciclan prenda, swipe táctil, preview con modal de detalle, X elimina fila, "Add row" custom (datalist).
- Campos: name, notes, scheduleDate (crea entrada de calendario si viene).
- Lista + detalle + edit + delete. Empty state con CTA.

### Calendar
- Vista semanal (dom–sáb, grid responsive 1→2→4→8 col) + mini calendario mensual navegable desacoplado.
- Día: chips de outfits con miniaturas sin fondo de hasta N prendas, tinte HSL por outfit (más intenso si worn), "+ BUILD_OUTFIT" → builder con scheduleDate.
- Marcar worn (toggle wornAt, botón ✓ WORN / MARK WORN), eliminar entrada. Historial = entradas con wornAt.

### Sharing
- Público por item: `/share?shareableId=…&type=garment|outfit` (sin login).
- Armario completo: invite links con permiso VIEW/MANAGE; accept/decline; upgrade VIEW→MANAGE; navegación `?ownerId=`; canManage = crear/editar/clonar; borrar/archivar solo owner.

### Users / Auth
- Registro con validación en vivo, login (throttle 5/60s), logout, perfil, reset de contraseña en 2 pasos, cambio de email, borrado de cuenta re-verificando credenciales. Cookie `access_token` httpOnly 365d. Modo sin auth (`AUTH_ENABLED=false`, owner null).

### PWA
- Manifest: standalone, shortcuts (Wardrobe, Outfits, Add Garment), screenshots, categorías lifestyle/utilities.
- SW Workbox: precache estáticos, NetworkFirst catch-all, NetworkOnly `/sse` y `/file/**`, offline.html para navegaciones, skipWaiting+clientsClaim, handler push.

## Valores predefinidos

- Categorías (8): accessories, bags, outerwear, dresses, tops, bottoms, footwear, other (+ custom libres).
- Colores (16): red, pink, orange, yellow, green, blue, purple, black, white, grey, beige, brown, gold, silver, pattern, other (+ custom).
- Tallas canónicas: XX-Small … 5X-Large (con normalización de alias).

## UX

- Dock inferior de 3 items: Wardrobe / Outfits / Calendar (+ navbar desktop con drawer móvil).
- Confirmaciones en acciones destructivas; empty-states ilustrados; pull-to-refresh; indicador offline/sync.

## Decisiones de adaptación para My Closet

- Arquitectura propia: Next.js App Router + React + TS estricto + Tailwind + Drizzle (SQLite dev / PostgreSQL prod) + IndexedDB offline-first con outbox y sync engine.
- La foto se procesa en el navegador (resize/WebP) antes de persistir; eliminación de fondo opcional y desactivable.
- Campos renombrados: `dateAquired` (typo original) → `dateAcquired`; `washingDetails` → `washingInstructions` en la UI (dominio en inglés, UI en español).
