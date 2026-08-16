# PR-002 — Capa offline (IndexedDB + outbox + sync engine)

**Rama**: `feat/offline-persistence` → `development`

## Cambios
- Dexie: esquema `my-closet` (garments/outfits/calendarEntries/
  wardrobeShares/images/outbox/kv) con índices por usuario y sync.
- Repositorios locales: toda escritura = transacción Dexie
  (entidad versionada + operación en outbox); clone con foto compartida,
  tombstones idempotentes, applyRemote con protección de versión local.
- Outbox: claim/markSynced/markFailed(pending|failed)/releaseStale.
- Sync engine: push por lotes → imágenes pendientes → pull incremental;
  disparadores (debounce, online, foreground, intervalo, Background Sync);
  SessionExpiredError conserva datos.
- Imágenes en navegador: validación, worker OffscreenCanvas (EXIF→1080px→
  WebP 0.82), fallback a hilo principal, cache de object URLs.

## Revisión
- 32 tests ✅ (fake-indexeddb + SQLite memoria) · build ✅
- Seguridad revisada: sin tokens en IndexedDB; solo blob de imagen.
