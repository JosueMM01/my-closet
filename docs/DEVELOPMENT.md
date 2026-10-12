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

No se necesita ningún servicio externo: la base es SQLite en
`./data/my-closet.db` y las imágenes se guardan localmente. El registro público
está desactivado por defecto también en desarrollo y pruebas. Las cuentas reales
se crean con invitación; el flag público solo se activa en E2E explícitos.

Para inicializar una base vacía, escribe tus propios valores juntos solo en
`.env.local` (ignorado por Git):

```dotenv
BOOTSTRAP_ADMIN_EMAIL=<correo elegido>
BOOTSTRAP_ADMIN_PASSWORD=<contraseña elegida de al menos 8 caracteres>
```

Inicia la app una vez. Si `users` está vacía se crea el administrador del slot 1
y solo se persiste el hash scrypt. Cuando puedas entrar, elimina ambas variables
de `.env.local`, especialmente `BOOTSTRAP_ADMIN_PASSWORD`; una configuración
parcial no es válida. No pongas valores reales en archivos versionados, comandos
compartidos, logs, docs ni fixtures.

## Scripts

### Entornos de Vercel y pruebas

Configuración verificada el 2026-10-05: Preview conserva Neon staging, secreto
de sesión independiente y URL estable de develop. Production no se modificó.
Development usa `NEXT_PUBLIC_APP_URL=http://localhost:3001`, SQLite, imágenes
locales, correo capture y Google/registro público desactivados por defecto.
No se sobrescribió `.env.local`: sus conexiones staging autorizadas siguen siendo
una selección explícita diferente de estos defaults aislados.

El CI/E2E aislado continúa en puerto 3100 y habilita registro únicamente en su
servidor de prueba. No necesita credenciales reales. Cambiar variables en Vercel
no actualiza deployments existentes: se aplicarán en la siguiente construcción
autorizada. No redeploy automáticamente para verificar un cambio de configuración.

### Prueba manual de cámara

En móvil/PWA, abrir Añadir prenda → Tomar foto, aceptar/cancelar captura y comprobar
preview, orientación, recorte y guardado. Elegir archivo debe seguir abriendo la
galería. Se solicita cámara tras pulsar, no al entrar en la página. El navegador
decide cómo atender `capture=environment`; si no lo soporta puede mostrar archivos.
No se mantiene una cámara encendida ni se añaden dependencias. Una foto capturada
se valida/procesa igual que una seleccionada; el borrador no debe subirse antes
de guardar la prenda. Comprobarlo en Xiaomi/A35 reales, no solo en emulación.

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

## Datos locales

La SQLite local se vació intencionalmente durante la funcionalidad de cuentas
y administración. No equivale a limpiar la PWA: IndexedDB es por origen del
navegador y la CLI no la elimina. La UI de datos de ejemplo fue retirada.

## Variables opcionales

Ver `.env.example`. La app arranca sin servicios externos; los selectores deben
activarse de forma explícita. Ejemplo para `.env.local`:

```dotenv
# Capturar correos sin conexión externa.
EMAIL_PROVIDER=capture
```

`PUBLIC_REGISTRATION_ENABLED=true` se reserva para el entorno aislado de E2E.
El login no muestra un enlace de creación aunque el flag esté activo.

Para SMTP con Gmail App Password, usar exactamente las variables documentadas
en `docs/EXTERNAL_SERVICES_SETUP.md#correo-smtp`. `SMTP_PASSWORD` es solo de
servidor. No activar Cloudinary ni SMTP en desarrollo normal.

Google Sign-In está implementado, pero permanece sin red con
`GOOGLE_AUTH_ENABLED=false`. Su activación opt-in se documenta en
`docs/EXTERNAL_SERVICES_SETUP.md`.

## Estructura

Ver docs/ARCHITECTURE.md. Lo esencial: `src/lib/domain` (dominio),
`src/lib/local` (IndexedDB/sync), `src/server` (backend Drizzle/auth),
`src/app` (rutas UI y API).

## Flujo Git

```text
main (estable)
└── develop (integración)
    ├── feat/*  fix/*  test/*  docs/*  chore/*
```

Cada unidad lógica: rama → tests → revisión del diff → commits atómicos
(Conventional Commits) → PR en GitHub → merge a `develop`.
Los conjuntos estables se promueven a `main` mediante otro PR revisado.
