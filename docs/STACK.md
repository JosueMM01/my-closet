# Stack de My Closet

Actualización: 2026-10-18. Las versiones ejecutables están en `package.json`
y `pnpm-lock.yaml`; este documento resume sus funciones y entornos.

## Tecnologías

| Área | Tecnología | Versión fijada o familia |
|---|---|---|
| Runtime | Node.js LTS | 24.13.0 en archivos de versión y CI; engines >=24.13.0 |
| Gestor de paquetes | pnpm | 12.14.0, resuelta desde el tag estable latest y fijada en packageManager |
| Framework | Next.js App Router | 16.3.1 |
| Interfaz | React / React DOM | 19.2.8 |
| Lenguaje | TypeScript estricto | 5.9.3 |
| Estilos | Tailwind CSS | 4.x |
| Base y migraciones | Drizzle ORM / Drizzle Kit | 0.45.2 / 0.31.10 |
| PostgreSQL | Neon / postgres.js | PostgreSQL 18 en producción / 3.4.9 |
| Base aislada | better-sqlite3 | 13.0.3 |
| Offline | Dexie / dexie-react-hooks | 4.4.5 / 4.4.0 |
| Validación | Zod | 4.4.3 |
| OAuth y criptografía JOSE | jose | 6.2.9 |
| Correo | Nodemailer | 9.0.5 |
| Eliminación de fondo | IMG.LY background-removal | 1.7.0 |
| Inferencia en navegador | ONNX Runtime Web | 1.21.0 |
| Pruebas unitarias e integración | Vitest | 4.1.10 |
| E2E | Playwright | 1.62.1 |

La versión de pnpm se fija de forma exacta para evitar cambios de herramienta
entre instalaciones y builds. GitHub Actions y Playwright reutilizan esa versión;
no requieren una instalación global.

## Entornos

| Entorno | Datos | Imágenes | Correo y acceso externo |
|---|---|---|---|
| Producción | PostgreSQL en Neon main | Cloudinary | Proveedores de producción configurados en Vercel |
| Preview autorizado | Neon staging o rama temporal aislada | Prefijo de pruebas separado para imágenes nuevas | Variables y sesión separadas de producción |
| Local y pruebas aisladas | SQLite en `./data/` | LocalImageStorage | Correo capture y OAuth desactivado por defecto |

IndexedDB se usa en todos los entornos para la experiencia offline del navegador.
Una rama Git no selecciona la base: verificar endpoint, proyecto y rama Neon antes
de cualquier migración. `.env.local` puede contener staging autorizado;
`drizzle.config.ts` le da prioridad al ejecutar migraciones locales.

Las credenciales pertenecen a los gestores de secretos y archivos ignorados.
No publicar valores reales en documentación, fixtures o logs. No procesar
imágenes en servidor ni conectar terceros en desarrollo sin autorización.

## Desarrollo y comprobaciones

Para iniciar, instalar las dependencias con la versión fijada y ejecutar Next.js:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev -- --port 3001
```

Las pruebas ordinarias usan SQLite, imágenes locales y correo capturado. Las
variables del proceso de prueba deben prevalecer sobre configuraciones reales.

```bash
pnpm typecheck
pnpm lint
pnpm test
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm e2e
```

Los E2E usan un build de producción local. Los contratos PostgreSQL de CI usan
un contenedor aislado. Las pruebas reales de modelos y servicios externos
requieren habilitación explícita. Las cifras válidas son las de cada ejecución,
no una cantidad histórica escrita en el README.

## Licencias y assets

Las imágenes demo en `public/demo/` proceden de Unsplash bajo Unsplash License.
Se descargan para desarrollo local y no son necesarias en producción.

| Archivo | Identificador de origen Unsplash |
|---|---|
| `tshirt-white.jpg` | `photo-1521572163474-6864f9cf17ab` |
| `dress-floral.jpg` | `photo-1595777457583-95e059d581b8` |
| `denim-jacket.jpg` | `photo-1576871337622-98d48d1cf531` |
| `leather-jacket.jpg` | `photo-1551028719-00167b16eac5` |
| `knit-sweater.jpg` | `photo-1434389677669-e08b4cac3105` |
| `sneakers.jpg` | `photo-1549298916-b41d501d3772` |
| `boots.jpg` | `photo-1533867617858-e7b97e060509` |
| `handbag.jpg` | `photo-1584917865442-de89df76afd3` |
| `blouse-beige.jpg` | `photo-1564257631407-4deb1f99d992` |
| `trench-coat.jpg` | `photo-1591047139829-d91aecb6caea` |

Los iconos de la app son obra propia, generados por `scripts/generate-icons.mjs`
a partir de `public/icon.svg`.
