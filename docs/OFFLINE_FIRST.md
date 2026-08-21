# Offline-first: cómo funciona

## Principio

```
UI → base local (IndexedDB) → sync engine → backend
```

Nunca `UI → red → esperar`. Todas las pantallas renderizan con datos
locales; la red solo interviene en segundo plano para replicar.

## Qué vive en el navegador (IndexedDB, DB `my-closet`)

| Tienda | Contenido |
|---|---|
| `garments` | Prendas (con `favorite`, `syncStatus`, `version`, `deletedAt`) |
| `outfits` | Outfits con slots ordenados |
| `calendarEntries` | Entradas de calendario (fecha, outfit, `wornAt`) |
| `wardrobeShares` | Invitaciones de compartir armario |
| `images` | Blobs WebP procesados + `remoteUrl` + estado de sync |
| `outbox` | Operaciones pendientes (ver docs/SYNC.md) |
| `kv` | Perfil local, estado de sync y contexto de sugerencias por usuario; sin secretos |
| `adminUsers`, `adminInvitations` | Caché de lectura de administración; no autoriza acciones de servidor |

## Service Worker (`public/sw.js`)

- **Precache** del shell: `/`, `/wardrobe`, `/wardrobe/new`, `/outfits`,
  `/outfits/new`, `/outfits/suggestions`, `/calendar`, `/profile`, `/offline`,
  iconos y manifest.
- Estrategias:
  - `/_next/static` e iconos → **CacheFirst** (inmutables).
  - Navegaciones → **NetworkFirst** → caché runtime → shell precacheado →
    `/offline`.
  - `/api/images/*` → **CacheFirst**.
  - Otros GET same-origin → **StaleWhileRevalidate**.
  - `/api/sync` y `/api/auth` → siempre red (el outbox reintenta).
- **Actualización controlada**: la nueva versión espera; la UI muestra
  «Hay una nueva versión disponible» → `SKIP_WAITING` → `controllerchange`
  recarga una sola vez. La primera instalación no recarga la página.
- **Background Sync** (`outbox-sync`): el SW avisa a las pestañas abiertas
  (`RUN_SYNC`) para que ejecuten el sync engine; no es el único mecanismo.

## Sin conexión a internet

- Abrir la app: el SW sirve el shell; IndexedDB abre sin permisos de red.
- Crear/editar/eliminar: se aplica localmente y queda pendiente en la outbox.
- El badge muestra `Sin conexión · N pendientes` — estado normal, no error.
- Fotos: se procesan y guardan localmente; la subida queda pendiente.
- Favoritas: el booleano de la prenda se actualiza localmente y queda en la
  outbox como cualquier otra edición.
- Sugerencias: `/outfits/suggestions` lee prendas, conjuntos y calendario de
  IndexedDB. Combina favoritas, compatibilidad básica de colores, coocurrencia
  guardada y penalizaciones por uso reciente con ocasión, temperatura, lluvia y
  estilo elegidos manualmente. El contexto validado se guarda por usuario en
  `kv`; las explicaciones son españolas y deterministas.
- El motor de sugerencias no usa IA, red ni análisis de fotos. Puede abrirse,
  variar opciones y guardar un conjunto sin conexión; guardar usa la misma
  transacción local y outbox que el editor normal.
- Administración de cuentas y envío de invitaciones: solo online. Sin conexión
  se puede consultar la caché administrativa disponible, pero no mutarla.

## Sesión remota expirada estando offline

No se borra nada. El perfil local permite usar la app; al intentar sincronizar
con sesión inválida (401), la UI marca «sesión remota expirada» y pide
re-login conservando datos y outbox (ver docs/AUTHENTICATION.md).

## Datos locales y reinicios

Durante esta funcionalidad se limpió intencionalmente la SQLite local
`./data/my-closet.db`. IndexedDB no forma parte de esa operación: es
almacenamiento por origen del navegador, persiste por separado y la CLI del
proyecto no lo borra.
