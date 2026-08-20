# My Closet

Tu armario digital: prendas, conjuntos y calendario, **una PWA offline-first**
que funciona siempre, con o sin conexión.

Inspirada funcionalmente en [Libre Closet](https://github.com/lazztech/libre-closet)
(referencia de dominio), con arquitectura propia en Next.js App Router.

```
UI ──► IndexedDB (fuente primaria) ──► sync engine (outbox) ──► backend
                                                                        │
                                                    SQLite (hoy) / Neon PostgreSQL (contrato futuro)
                                                    imágenes: local (hoy) / Cloudinary (contrato futuro)
```

## Requisitos

- **Node.js 24 LTS** (`.nvmrc` y `.node-version` fijan `24.13.0`)
- **pnpm 11** (`nvm use && corepack enable` o `npx -y pnpm@11.22.0 …`)

## Puesta en marcha

```bash
git clone <repo-local> my-closet && cd my-closet
pnpm install
pnpm dev          # → http://localhost:3000
```

**No necesitas configurar nada**: sin variables de entorno la app usa
SQLite (`./data/my-closet.db`, se crea solo) e imágenes locales. En desarrollo
o pruebas el registro público está permitido por defecto; la primera cuenta de
una base local vacía recibe el rol `ADMIN` en el slot 1. En producción el
registro público está cerrado por defecto y solo se abre con
`PUBLIC_REGISTRATION_ENABLED=true`.

La base SQLite local se vació intencionalmente durante la funcionalidad de
cuentas y administración. Esto no borra IndexedDB: esa base pertenece a cada
origen del navegador y no se limpia mediante la CLI del proyecto.

El perfil permite cambiar nombre, contraseña, correo y foto. La foto se
redimensiona y convierte a WebP en el navegador, sin eliminación de fondo.
Ya no hay UI para cargar datos de demostración.

## Scripts principales

| Comando | Descripción |
|---|---|
| `pnpm dev` | Desarrollo |
| `pnpm build` / `pnpm start` | Producción local |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript estricto |
| `pnpm test` | Vitest: unitarios + integración |
| `pnpm e2e` | build + Playwright (Chromium) |

Chromium de Playwright se instala **dentro del proyecto**:

```bash
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm exec playwright install chromium
```

## Funciona sin servicios externos

Neon, Cloudinary, Google Sign-In y Vercel tienen selectores y contratos
**preparados y desactivados**. Los adaptadores externos no se activan solo por
encontrar credenciales y siguen pendientes de implementación/verificación.
La app completa (auth local, sync contra SQLite, imágenes, PWA, offline)
se desarrolla, prueba y demuestra sin ninguna cuenta externa. Para
activarlos más adelante: **`docs/EXTERNAL_SERVICES_SETUP.md`**.

## Versiones principales utilizadas

| Paquete | Versión |
|---|---|
| Node.js (LTS) | 24.13.0 (`.nvmrc`, `engines >=24 <25`) |
| pnpm | 11.22.0 |
| next | 16.3.1 |
| react / react-dom | 19.2.8 |
| typescript | 5.9.3 * |
| tailwindcss | ^4 (4.x) |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 |
| better-sqlite3 | 13.0.3 |
| dexie / dexie-react-hooks | 4.4.5 / 4.4.0 |
| zod | 4.4.3 |
| @imgly/background-removal | 1.7.0 |
| onnxruntime-web | 1.21.0 |
| @playwright/test | 1.62.1 |
| vitest | 4.1.10 |

\* TypeScript 7.0.2 es la última publicada, pero typescript-eslint (usado
por eslint-config-next) soporta `<6.1.0`; 5.9.3 es la última estable
**compatible** con el toolchain actual.

## Documentación

- `docs/ARCHITECTURE.md` — capas y flujo offline-first
- `docs/OFFLINE_FIRST.md` — IndexedDB, Service Worker, offline
- `docs/SYNC.md` — outbox, conflictos, cambio de dispositivo
- `docs/AUTHENTICATION.md` — sesiones, cookies HttpOnly, offline
- `docs/IMAGES.md` — pipeline en el navegador, Cloudinary
- `docs/DEVELOPMENT.md` — entorno local, SQLite e IndexedDB
- `docs/TESTING.md` — cómo ejecutar y qué cubre cada suite
- `docs/SECURITY.md` — CSP, CSRF, rate limit, secretos
- `docs/DEPLOYMENT.md` — checklist Vercel (sin ejecutar)
- `docs/EXTERNAL_SERVICES_SETUP.md` — activar Neon/Cloudinary/Google/Vercel
- `docs/decisions/` — ADRs · `docs/local-prs/` — revisiones tipo PR

## Licencia de assets

Fotos demo: Unsplash License (ver `docs/ASSET_SOURCES.md`). Iconos: obra
propia del proyecto.
