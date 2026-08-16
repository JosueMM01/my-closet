# ADR-004: IndexedDB (Dexie) como fuente primaria de la UI

## Status
Accepted

## Context
La app debe funcionar sin conexión: la UI nunca puede depender de una
respuesta del servidor para renderizar datos propios.

## Decision
- **IndexedDB es la base offline del navegador** vía Dexie
  (`src/lib/local/db.ts`), con tablas: garments, outfits, calendarEntries,
  wardrobeShares, images, outbox y kv.
- La UI lee **solo** de IndexedDB (`useLiveQuery` de dexie-react-hooks):
  los cambios se reflejan al instante, con o sin red.
- Toda escritura pasa por repositorios locales
  (`src/lib/local/repositories.ts`) que en una transacción Dexie: (1)
  persisten la entidad con `syncStatus: pending` y `version+1`, y (2)
  encolan la operación en la **outbox**.
- No se usa SQLite WASM/OPFS en el navegador (sin justificación técnica).

## Consequences
- UX instantánea y offline real; el servidor es solo réplica.
- Los datos se particionan por `userId` en cada tabla.
- Requiere disciplina: nunca consultar el servidor directamente desde la UI.
