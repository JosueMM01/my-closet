# My Closet

Tu armario digital: prendas, conjuntos, sugerencias y calendario, **una PWA
offline-first** que funciona siempre, con o sin conexión.

Inspirada funcionalmente en [Libre Closet](https://github.com/lazztech/libre-closet)
(referencia de dominio), con arquitectura propia en Next.js App Router.

```
UI ──► IndexedDB (fuente primaria) ──► sync engine (outbox) ──► backend
                                                                        │
                                                    SQLite local / Neon PostgreSQL staging-producción
                                                    imágenes: local / Cloudinary directo
```

## Requisitos

- **Node.js 24 LTS** (`.nvmrc` y `.node-version` fijan `24.13.0`)
- **pnpm 12.14.0**, fijado en `packageManager` (`corepack pnpm` o `npx -y pnpm@12.14.0 …`)

## Puesta en marcha

```bash
git clone <repo-local> my-closet && cd my-closet
pnpm install
pnpm dev -- --port 3001   # → http://localhost:3001
```

**No necesitas configurar servicios externos**: sin variables de entorno la
app usa SQLite (`./data/my-closet.db`, se crea solo) e imágenes locales. El
registro público está desactivado por defecto en todos los entornos y el login
no ofrece «Crear cuenta». Las personas usuarias se registran mediante el
fragmento de un enlace de invitación de cuenta.

Para crear de forma segura el primer administrador, define tus propios
`BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` juntos únicamente en el
archivo ignorado `.env.local`, inicia la app una vez con `users` vacía y elimina
después ambas variables bootstrap, en especial la contraseña. Solo se persiste
su hash scrypt. `PUBLIC_REGISTRATION_ENABLED=true` se reserva para E2E
explícitos.

La base SQLite local se vació intencionalmente durante la funcionalidad de
cuentas y administración. Esto no borra IndexedDB: esa base pertenece a cada
origen del navegador y no se limpia mediante la CLI del proyecto.

El perfil permite cambiar nombre, contraseña, correo y foto. La foto se
redimensiona y convierte a WebP en el navegador, sin eliminación de fondo.
Ya no hay UI para cargar datos de demostración.

`/outfits/suggestions` propone hasta tres conjuntos de forma determinista y
local desde IndexedDB. Considera favoritas, compatibilidad básica de colores,
coocurrencia en conjuntos guardados, uso reciente y el contexto manual de
ocasión, temperatura, lluvia y estilo. Explica el resultado en español, no usa
IA, red ni análisis de fotos y funciona offline.

## Scripts principales

| Comando | Descripción |
|---|---|
| `pnpm dev` | Desarrollo |
| `pnpm build` / `pnpm start` | Producción local |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript estricto |
| `pnpm test` | Vitest: unitarios + integración |
| `pnpm e2e` | build + Playwright (Chromium) |

Los resultados vigentes de pruebas se consultan en cada ejecución de CI. La
prueba del modelo real de eliminación de fondo es opt-in y se ejecuta por separado.

Chromium de Playwright se instala **dentro del proyecto**:

```bash
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm exec playwright install chromium
```

## Funciona sin servicios externos

Neon, Cloudinary, Google Sign-In y Vercel requieren selectores explícitos.
Google Sign-In está implementado pero es opt-in; solo inicia sesión en una
cuenta existente que antes se vinculó desde Perfil con el mismo correo
verificado. Neon y Cloudinary tienen runtime y flujo directo funcionales, pero
solo deben activarse explícitamente y probarse primero en staging. La app local
no realiza llamadas externas con los proveedores desactivados. Detalles:
**[Stack y entornos](docs/STACK.md#entornos)**.

## Stack

Las versiones y la separación entre producción, desarrollo y pruebas se
documentan en [STACK.md](docs/STACK.md). `package.json` y `pnpm-lock.yaml`
son la referencia ejecutable de dependencias.

## Documentación

- [PHASES.md](docs/PHASES.md) — fases y pendientes del proyecto
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — capas, datos y flujo offline-first
- [STACK.md](docs/STACK.md) — tecnologías, entornos, herramientas y licencias

## Licencia de assets

Fotos demo: Unsplash License (ver [STACK.md](docs/STACK.md#licencias-y-assets)). Iconos: obra
propia del proyecto.
