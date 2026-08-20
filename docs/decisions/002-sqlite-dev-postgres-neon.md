# ADR-002: SQLite en desarrollo local, PostgreSQL (Neon) en producción

## Status
Accepted

## Context
El backend de sincronización necesita una base de datos real en local sin
servicios externos, y en producción usará Neon PostgreSQL. Drizzle ORM
soporta ambos dialectos pero con APIs de driver distintas.

## Decision
- **Desarrollo**: `better-sqlite3` con fichero local `./data/my-closet.db`
  (creado e inicializado automáticamente; DDL idempotente en
  `src/server/db/index.ts`). `DATABASE_URL` vacía o `file:` → SQLite.
- **Producción futura**: `DATABASE_URL=postgresql://…` (Neon) será el
  contrato del adaptador PostgreSQL y del esquema espejo
  `src/server/db/schema-pg.ts`. El adaptador, sus migraciones y pruebas de
  contrato siguen pendientes; configurar la URL hoy no habilita producción.
- Ambos esquemas almacenan **fechas ISO 8601 como texto** y JSON como texto,
  para que la semántica de comparación de sync sea idéntica en ambos
  dialectos (comparación lexicográfica de `updatedAt`).

## Consequences
- Desarrollo 100% local sin contenedores ni cuentas.
- Los repositorios de sync están escritos contra el esquema SQLite; el
  contrato (upsert con conflicto + pull incremental) se replica en PG al
  conectar Neon (ver docs/EXTERNAL_SERVICES_SETUP.md).
- Diferencia de dialectos documentada y encapsulada en `src/server/db`.
