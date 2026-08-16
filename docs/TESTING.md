# Testing

## Unit + integración (Vitest 4)

```bash
pnpm test          # vitest run
pnpm test:watch
```

- `tests/unit/` — lógica pura: resolución de conflictos, validación Zod,
  normalización de tallas, utilidades de fechas.
- `tests/integration/` —
  - repositorios locales con **fake-indexeddb**: persistencia, outbox,
    tombstones, aislamiento por usuario, conflictos;
  - repositorio de sync del servidor con **SQLite en memoria**: upserts,
    conflictos de versión, pull incremental, protección IDOR, scrypt.

## E2E (Playwright 1.62, Chromium)

```bash
pnpm e2e           # next build + playwright test
```

- El servidor de pruebas arranca `next start` en el puerto 3100 con
  `AUTH_SECRET` de prueba y rate limit elevado.
- Chromium se instala **dentro del proyecto**:
  `PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm exec playwright install chromium`.
- Proyectos: `chromium-mobile-small` (360×800) y `chromium-desktop`.

### Cobertura

| Spec | Flujos |
|---|---|
| `auth.spec.ts` | registro, login, logout+login, credenciales inválidas, rutas privadas → /login |
| `wardrobe.spec.ts` | crear, editar, archivar, clonar, eliminar, búsqueda, filtros por categoría |
| `outfits.spec.ts` | builder, lista, programar → calendario, marcar vestido, quitar del calendario |
| `offline.spec.ts` | online → offline → crear → recargar (persiste) → online → «Sincronizado» |
| `visual.spec.ts` | capturas en móvil/desktop: login, home, armario, detalle, formulario, outfits, calendario |

Las capturas se guardan en `tests/e2e/screenshots/` para revisión visual
contra `UI-Reference/`.

### Notas de estabilidad

- `waitForHydration(page)` (helpers) espera a `networkidle` antes de
  interactuar: evita perder fills durante la hidratación de React.
- Este Chromium no cambia `navigator.onLine` con `context.setOffline`:
  el test de offline también dispara el evento `offline` real que la app
  escucha (la red sí queda bloqueada de verdad).

## Typecheck y lint

```bash
pnpm typecheck     # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm lint          # eslint (eslint-config-next)
```
