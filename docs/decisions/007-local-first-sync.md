# ADR-007: Sync local-first con outbox y last-writer-wins

## Status
Accepted

## Context
Varios dispositivos pueden editar el mismo armario. Se necesita replicación
sin CRDTs (complejidad no justificada para este dominio).

## Decision
- **Outbox** (`src/lib/local/outbox.ts`): cada escritura local encola
  `upsert|delete` con snapshot completo. Estados: pending/syncing/failed.
  Una operación **nunca** se descarta por fallos de red.
- **Sync engine** (`src/lib/local/sync-engine.ts`): push por lotes (50) →
  subida de imágenes pendientes → pull incremental (`since=lastPulledAt`).
  Disparadores: tras escribir (debounce 800 ms), `online`,
  `visibilitychange`, intervalo 60 s y Background Sync (`outbox-sync`)
  cuando exista; siempre con fallback al abrir/reanudar.
- **Conflictos** (`src/lib/domain/conflict.ts`): gana mayor `version`;
  empate → mayor `updatedAt`; empate → mayor `id` (determinista, evita
  ping-pong). El servidor aplica la misma regla y devuelve `conflict` +
  la entidad ganadora para aplicarla localmente. Borrados = tombstones
  (`deletedAt`) que compiten como cualquier escritura.

## Consequences
- Cambio de dispositivo: login → pull completo → IndexedDB reconstruido →
  offline de nuevo.
- Sin CRDTs: si dos dispositivos editan el MISMO campo, la última
  escritura gana (documentado y suficiente para un armario personal).
- 401 del servidor = sesión expirada: se conservan datos y outbox.
