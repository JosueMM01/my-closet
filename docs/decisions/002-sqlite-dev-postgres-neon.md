# ADR-002: SQLite en desarrollo local, PostgreSQL (Neon) en producción

## Status
Accepted · implementado en staging el 2026-08-21

## Context
El backend de sincronización necesita una base de datos real en local sin
servicios externos, y en producción usará Neon PostgreSQL. Drizzle ORM
soporta ambos dialectos pero con APIs de driver distintas.

## Decision
- **Desarrollo**: `better-sqlite3` con fichero local `./data/my-closet.db`
  (creado e inicializado automáticamente; DDL idempotente en
  `src/server/db/index.ts`). `DATABASE_URL` vacía o `file:` → SQLite.
- **Staging/producción**: `DATABASE_URL` usa la conexión pooled de Neon para el
  runtime serverless y `DATABASE_URL_UNPOOLED` la conexión directa para
  migraciones. El esquema completo vive en `src/server/db/schema-pg.ts`, los
  repositorios soportan ambos dialectos y existe una prueba de contrato PG.
- Los campos de sync mantienen fechas ISO 8601 y JSON como texto para conservar
  la misma comparación lexicográfica de `updatedAt`. Las tablas de sistema PG,
  incluidas recuperación e identidades, usan `timestamp with time zone` donde
  corresponde; SQLite conserva texto ISO.

## Consequences
- Desarrollo 100% local sin contenedores ni cuentas.
- Los repositorios de sync, autenticación, administración, invitaciones,
  recuperación, identidades e imágenes conservan el mismo contrato en ambos
  dialectos.
- Las migraciones se ejecutan con conexión directa y el runtime usa pooling
  compatible con funciones serverless.
- Diferencia de dialectos documentada y encapsulada en `src/server/db`.
