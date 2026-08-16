# PR-001 — Fundación del proyecto

**Rama**: `feat/domain` (+ chore inicial) → `development`

## Cambios
- Scaffold Next.js 16 + React 19 + TS estricto + Tailwind 4 + ESLint 9.
- Pin de versiones: `.nvmrc`/`.node-version` (24.13.0), `engines` (>=24 <25),
  `packageManager` pnpm 11.22.0.
- Dependencias: drizzle-orm, better-sqlite3, dexie, zod, playwright,
  vitest (+ dev tooling).
- Dominio: tipos de entidades sincronizables, constantes (categorías,
  colores, tallas con normalización de alias), validación Zod v4
  (manejo de claves ausentes), reglas de conflicto LWW, fechas locales.

## Revisión
- Tests: 26 unit/integración ✅ · tsc strict ✅ · eslint ✅
- Decisiones: TS 5.9.3 (typescript-eslint no soporta TS 7 aún — documentado).
