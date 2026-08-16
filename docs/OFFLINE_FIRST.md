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
| `garments` | Prendas (con `syncStatus`, `version`, `deletedAt`) |
| `outfits` | Outfits con slots ordenados |
| `calendarEntries` | Entradas de calendario (fecha, outfit, `wornAt`) |
| `wardrobeShares` | Invitaciones de compartir armario |
| `images` | Blobs WebP procesados + `remoteUrl` + estado de sync |
| `outbox` | Operaciones pendientes (ver docs/SYNC.md) |
| `kv` | Perfil local (sin secretos), estado de sync, preferencias |

## Service Worker (`public/sw.js`)

- **Precache** del shell: `/`, `/wardrobe`, `/wardrobe/new`, `/outfits`,
  `/outfits/new`, `/calendar`, `/profile`, `/offline`, iconos y manifest.
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

## Sesión remota expirada estando offline

No se borra nada. El perfil local permite usar la app; al intentar sincronizar
con sesión inválida (401), la UI marca «sesión remota expirada» y pide
re-login conservando datos y outbox (ver docs/AUTHENTICATION.md).
