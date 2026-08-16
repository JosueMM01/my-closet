<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reglas del proyecto My Closet (obligatorias para agentes)

## Producción (futuro)
Next.js + Vercel · PostgreSQL + Neon · Cloudinary

## Local (hoy)
Next.js · SQLite para backend/dev (`./data/my-closet.db`) · IndexedDB para
offline (Dexie) · LocalImageStorage · sin servicios externos conectados

## Never
- tokens de sesión en localStorage / sessionStorage / IndexedDB
- secretos de producción en Git, logs, docs o fixtures
- instalación global de herramientas (`npm i -g` / `pnpm add -g`)
- procesamiento de imágenes en el servidor (se hace en el navegador)
- conexiones reales a terceros durante el desarrollo local
- `git push` / creación de remotos (repo 100% local por decisión del dueño)
- UI leyendo directamente de la red: siempre IndexedDB + sync engine

## Siempre
- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`); `any` solo
  con justificación escrita en el código
- Validación Zod en cada boundary (form → cliente → API → sync)
- Escrituras locales: transacción Dexie (entidad versionada + outbox)
- App Router únicamente (sin Pages Router ni patrones legacy)
- Commits atómicos estilo Conventional Commits; una rama por unidad lógica

## Cómo ejecutar pruebas
```bash
pnpm typecheck && pnpm lint          # estáticos
pnpm test                            # vitest (unit + integración)
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm e2e   # E2E (build+playwright)
```

## Arquitectura en 30 segundos
`src/lib/domain` (puro, compartido) · `src/lib/local` (IndexedDB/outbox/sync)
· `src/lib/images` (pipeline WebP en worker) · `src/server` (Drizzle
SQLite/PG, auth scrypt, ImageStorage) · `src/app/api` (rutas nodejs) ·
`src/app/(app)` (UI que lee IndexedDB).

## Lectura recomendada
`docs/ARCHITECTURE.md` · `docs/SYNC.md` · `docs/OFFLINE_FIRST.md` ·
`docs/SECURITY.md` · ADRs en `docs/decisions/` · decisiones tipo PR en
`docs/local-prs/`.
