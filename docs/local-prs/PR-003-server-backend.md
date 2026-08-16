# PR-003 — Backend de sincronización y auth

**Rama**: `feat/server-backend` → `development`

## Cambios
- Drizzle dual: `schema-sqlite.ts` (dev, DDL idempotente en arranque) y
  `schema-pg.ts` (Neon); fábrica por `DATABASE_URL`; drizzle.config dinámico.
- Auth: scrypt + sesiones en BD (cookie HttpOnly firmada con HMAC),
  rate limit (login 5/60s; registro configurable), chequeo Origin (CSRF).
- API: auth/*, sync/push (validación por entidad + conflicto + IDOR),
  sync/pull incremental, images (upload/serve/sign), share público.
- Cabeceras de seguridad + CSP en next.config.ts.

## Revisión
- Tests integración: upsert/conflicto/pull/IDOR/aislamiento ✅
- Diff revisado: sin secretos, errores genéricos, sin fuga de internals.
