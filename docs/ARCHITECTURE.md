# Arquitectura de My Closet

```
                      MY CLOSET
                          │
                   Next.js 16 PWA (App Router)
                          │
            ┌─────────────┴──────────────┐
            │                            │
       UI (React 19)              API routes (nodejs)
       'use client'                src/app/api/**
            │                            │
       IndexedDB (Dexie)          Auth · Sync · Images · Share
       offline-first                    │
       outbox                           │
       sync engine               Drizzle ORM
       local images                     │
            │                    ┌───────┴────────┐
            │                    │                │
            │              SQLite (dev)    PostgreSQL (prod futuro)
            │              better-sqlite3   Neon + postgres.js
            │                    │                │
            └──── imágenes ──────┴── LocalImageStorage / CloudinaryImageStorage
```

## Capas

| Capa | Ruta | Responsabilidad |
|---|---|---|
| Dominio | `src/lib/domain/` | Tipos, constantes, validación Zod, reglas de conflicto, fechas, ids. Compartido cliente/servidor. |
| Base local | `src/lib/local/` | Dexie (IndexedDB), repositorios con outbox, sync engine, kv, queries de UI. |
| Imágenes cliente | `src/lib/images/` | Validación, Web Worker (EXIF→resize→WebP), cache de object URLs. |
| Auth cliente | `src/lib/auth/` | register/login/logout contra la API; perfil local (sin secretos). |
| Servidor | `src/server/` | env validado, Drizzle (SQLite/PG), sesiones, rate limit, repositorios, ImageStorage. |
| API | `src/app/api/` | auth (register/login/logout/session/providers), sync (push/pull), images (upload/get/sign), share público. |
| UI | `src/app/(app)/`, `src/app/(auth)/`, `src/app/share/` | Páginas y componentes. La UI lee IndexedDB, nunca la red. |

## Flujo de escritura (offline-first)

```
acción usuario → repositorio local (transacción Dexie)
  1. persiste entidad {version+1, updatedAt=now, syncStatus:'pending'}
  2. encola operación en outbox (upsert|delete + snapshot)
→ useLiveQuery actualiza la UI al instante
→ maybeSync() (debounce) → runSync():
     push outbox por lotes → POST /api/sync/push
     subir imágenes pendientes → POST /api/images
     pull incremental → GET /api/sync/pull?since=…
```

## Flujo de lectura

La UI **solo** lee IndexedDB (`useLiveQuery`). El servidor se consulta
únicamente desde el sync engine y en el chequeo periódico de sesión.

## Diferencias de dialecto SQLite/PostgreSQL

Ver ADR-002. Resumen: fechas ISO y JSON como `text` en ambos dialectos;
SQLite usa `integer` booleano y `blob` para imágenes; PostgreSQL usa
`boolean`/`timestamp` en tablas de sistema y `text` para los campos de
sync. El contrato de repositorios es idéntico.

## Decisiones registradas

`docs/decisions/001…007` (Next/Vercel, SQLite/Neon, Cloudinary,
IndexedDB, imágenes en cliente, cookies seguras, sync local-first).
