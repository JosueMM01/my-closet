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
       IndexedDB (Dexie)           Auth · OAuth · Recovery · Admin · Sync · Images
       offline-first                    │
       outbox                           │
       sync engine               Drizzle ORM
       local images                     │
            │                    ┌───────┴────────┐
            │                    │                │
            │              SQLite (dev)    PostgreSQL (staging/prod)
            │              better-sqlite3   Neon + postgres.js
            │                    │                │
            └──── imágenes ──────┴── LocalImageStorage / CloudinaryImageStorage
```

## Capas

| Capa | Ruta | Responsabilidad |
|---|---|---|
| Dominio | `src/lib/domain/` | Tipos, validación Zod, conflictos, fechas, ids y ranking puro de sugerencias. `favorite` es parte versionada de `Garment`. |
| Base local | `src/lib/local/` | Dexie (IndexedDB), repositorios con outbox, sync engine, KV por usuario, queries de UI y caché administrativa. |
| Imágenes cliente | `src/lib/images/` | Validación, Web Worker (EXIF→resize→WebP), cache de object URLs. |
| Auth cliente | `src/lib/auth/`, `src/lib/account/`, `src/lib/admin/` | login, alta por invitación, recuperación, perfil local sin secretos y administración. |
| Servidor | `src/server/` | env validado, Drizzle, sesiones, bootstrap admin, rate limit, OAuth Google, recuperación, mail e ImageStorage. |
| API | `src/app/api/` | auth/OAuth, perfil, administración, sync, images y share público. |
| UI | `src/app/(app)/`, `src/app/(auth)/`, `src/app/share/` | Páginas y componentes. La UI lee IndexedDB, nunca la red. |

## Flujo de escritura (offline-first)

```
acción usuario → repositorio local (transacción Dexie)
  1. persiste entidad {version+1, updatedAt=now, syncStatus:'pending'}
  2. encola operación en outbox (upsert|delete + snapshot)
→ useLiveQuery actualiza la UI al instante
→ maybeSync() (debounce) → runSync():
     push outbox por lotes → POST /api/sync/push
     subir imágenes pendientes → local: POST /api/images
                                → cloud: firma + Cloudinary + POST /api/images/finalize
     pull incremental (entidades + metadatos de imágenes) → GET /api/sync/pull?since=…
```

## Flujo de lectura

La UI **solo** lee IndexedDB (`useLiveQuery`). El servidor se consulta
únicamente desde el sync engine y en el chequeo periódico de sesión.
Las operaciones administrativas son la excepción deliberada: se hacen online
contra `/api/admin/*`; IndexedDB solo conserva su último read model y no es
una fuente de autorización.

## Sugerencias locales de conjuntos

`recommendOutfits()` es una función pura y determinista: recibe prendas,
conjuntos y calendario leídos de IndexedDB, más una semilla de variación y el
contexto manual validado con Zod. Puntúa favoritas, compatibilidad básica de
colores, pares que coocurren en conjuntos guardados y penaliza prendas marcadas
como usadas recientemente. Ocasión, temperatura, lluvia y estilo determinan la
receta y categorías opcionales; devuelve hasta tres opciones con explicaciones
breves en español.

El contexto se guarda por usuario en `kv` bajo `recommendations:context:*`. No
se sincroniza ni contiene secretos. El motor no llama APIs, no usa IA ni analiza
fotos; `/outfits/suggestions` está en el shell offline.

## Diferencias de dialecto SQLite/PostgreSQL

SQLite usa `integer` booleano y `blob` para imágenes; PostgreSQL
usa `boolean`/`timestamp` en tablas de sistema y `text` para campos de sync.
Los diez conjuntos de tablas tienen declaraciones en ambos dialectos. Neon usa
postgres.js, una migración base Drizzle y repositorios con el mismo contrato;
las migraciones usan URL directa y el runtime una URL pooled.
