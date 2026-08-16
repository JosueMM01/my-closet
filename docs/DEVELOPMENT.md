# Desarrollo local

## Requisitos

- **Node.js 24 LTS** (`.nvmrc`/`.node-version` fijan 24.13.0; `engines`
  exige `>=24 <25`).
- **pnpm 11** (`packageManager: pnpm@11.22.0`; con npx:
  `npx -y pnpm@11.22.0 <cmd>`).

## Puesta en marcha

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

No se necesita ninguna variable de entorno: la base de datos es SQLite en
`./data/my-closet.db` (se crea sola) y las imágenes se guardan localmente.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` / `pnpm start` | Build y servidor de producción local |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | tsc --noEmit (strict) |
| `pnpm test` | Vitest (unit + integración) |
| `pnpm e2e` | build + Playwright (Chromium del proyecto) |
| `pnpm db:generate` / `db:migrate` | drizzle-kit (migraciones SQL) |
| `pnpm db:studio` | Drizzle Studio |

Primera vez con Playwright:

```bash
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm exec playwright install chromium
```

## Datos de ejemplo

Perfil → «Cargar datos de ejemplo»: crea 10 prendas con foto (public/demo,
Unsplash), 2 outfits y una entrada de calendario. Todo pasa por el pipeline
normal (procesamiento WebP en el navegador incluido).

## Variables opcionales

Ver `.env.example`. Todo funciona sin configurar nada; Cloudinary/Google
activan funciones extra cuando existen sus variables.

## Estructura

Ver docs/ARCHITECTURE.md. Lo essencial: `src/lib/domain` (dominio),
`src/lib/local` (IndexedDB/sync), `src/server` (backend Drizzle/auth),
`src/app` (rutas UI y API).

## Flujo Git

```text
main (estable)
└── development (integración)
    ├── feat/*  fix/*  test/*  docs/*  chore/*
```

Cada unidad lógica: rama → tests → revisión del diff → commits atómicos
(Conventional Commits) → revisión tipo PR (docs/local-prs/) → merge a
`development`. Los conjuntos estables se promueven a `main`. Sin remotes.
