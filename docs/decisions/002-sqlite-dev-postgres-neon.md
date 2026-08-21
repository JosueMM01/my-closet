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
  `src/server/db/schema-pg.ts`. Ya hay declaraciones y migraciones SQLite/PG
  para `password_reset_tokens` y `auth_accounts`; faltan las migraciones base
  completas, repositorios runtime PG y pruebas de contrato. Configurar la URL
  hoy no habilita producción.
- Los campos de sync mantienen fechas ISO 8601 y JSON como texto para conservar
  la misma comparación lexicográfica de `updatedAt`. Las tablas de sistema PG,
  incluidas recuperación e identidades, usan `timestamp with time zone` donde
  corresponde; SQLite conserva texto ISO.

## Consequences
- Desarrollo 100% local sin contenedores ni cuentas.
- Los repositorios de sync están escritos contra el esquema SQLite; el
  contrato (upsert con conflicto + pull incremental) se replica en PG al
  conectar Neon (ver docs/EXTERNAL_SERVICES_SETUP.md).
- Recuperación e identidades externas también operan solo con repositorios
  SQLite hasta implementar sus equivalentes PostgreSQL.
- Diferencia de dialectos documentada y encapsulada en `src/server/db`.
