# Motor de sincronización

## Outbox

Toda escritura local genera una operación:

```text
operationId · entityType · entityId · operation(upsert|delete)
payload (snapshot completo) · createdAt · attempts · status · lastError
```

Estados: `pending` → `syncing` → (éxito: se elimina) | `failed`
(permanente: validación del servidor) | `pending` (transitorio: red).

Una operación **nunca** se descarta por fallo de red. Las que quedaron en
`syncing` tras un crash vuelven a `pending` al iniciar (`releaseStaleSyncing`).

## Ciclo (`runSync`)

1. `releaseStaleSyncing()`.
2. **Push** por lotes de 50 → `POST /api/sync/push`.
   Por operación el servidor responde:
   - `applied` → se elimina de la outbox; la entidad pasa a `synced` solo
     si su versión local no avanzó entretanto.
   - `conflict` → el servidor conservó una versión más nueva; se aplica la
     entidad remota localmente (ver resolución abajo).
   - `invalid` → error permanente (validación/IDOR): la operación queda
     `failed` con el motivo, sin reintento infinito.
3. **Imágenes pendientes** → `POST /api/images` (multipart WebP).
4. **Pull** → `GET /api/sync/pull?since=lastPulledAt` → se aplican las
   entidades remotas que ganen el conflicto; se guarda `lastPulledAt`
   con el `serverTime` de la respuesta.

## Disparadores

| Evento | Acción |
|---|---|
| Escritura local | `maybeSync()` con debounce 800 ms |
| `window.online` | `maybeSync()` |
| `visibilitychange` → visible | `maybeSync()` |
| Intervalo | cada 60 s |
| Background Sync (`outbox-sync`) | el SW pide `RUN_SYNC` a las pestañas |
| Carga de la app | `startSyncEngine()` → `maybeSync()` |

No se depende exclusivamente de Background Sync: siempre existe el
fallback abrir/reanudar → detectar pendientes → sincronizar.

## Resolución de conflictos (last-writer-wins, sin CRDT)

```text
1. mayor version gana
2. empate → mayor updatedAt gana
3. empate → mayor id lexicográfico gana (determinista, evita ping-pong)
```

Los borrados son tombstones (`deletedAt`) que compiten como cualquier
escritura: una eliminación más reciente que una edición gana.

## Cambio de dispositivo

```
nuevo dispositivo → login → pull completo (since=null)
→ servidor (SQLite hoy / Neon mañana) + imágenes
→ IndexedDB reconstruido → offline de nuevo
```

Probado localmente: dos navegadores contra el mismo backend local ven los
mismos datos tras el sync (E2E `offline.spec.ts` + tests de integración).
