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
   entidades remotas que ganen el conflicto y los metadatos de imágenes; se
   guarda `lastPulledAt` con el `serverTime` de la respuesta.

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

`favorite` es un booleano de `Garment`: se escribe primero en IndexedDB,
genera la operación normal de la outbox y se replica con este mismo LWW por
entidad. No tiene un canal de sincronización separado.

## Cambio de dispositivo

```
nuevo dispositivo → login → pull completo (since=null)
→ entidades + metadatos de imágenes del servidor
→ IndexedDB reconstruido → las fotos se muestran mediante remoteUrl
```

El pull de metadatos de imagen es necesario en producción y al añadir un
dispositivo. No transfiere binarios: conserva cualquier blob local existente y
los registros remotos sin blob usan `remoteUrl`. Solo se debe hidratar/descargar
el binario si se quiere garantizar uso offline inmediatamente después del sync.

La aceptación de invitaciones para compartir armario no está completada; el
modelo puede crear, modificar y revocar esos enlaces, pero no debe documentarse
como un flujo de aceptación implementado.
