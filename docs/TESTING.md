# Testing

## Unit + integración (Vitest 4)

```bash
pnpm test          # vitest run
pnpm test:watch
```

- `tests/unit/` — lógica pura: conflictos, Zod, sugerencias deterministas,
  proveedores, correo y validación criptográfica de Google con mocks.
- `tests/integration/` —
  - repositorios locales con **fake-indexeddb**: persistencia, outbox,
    tombstones, aislamiento por usuario, conflictos;
  - repositorio de sync del servidor con **SQLite en memoria**: upserts,
     conflictos de versión, pull incremental, protección IDOR y scrypt;
  - cuentas/invitaciones, bootstrap, recuperación hash-only, migraciones e
    identidades Google con red/JWKS simulados.

Estado conocido: **124 pruebas Vitest pasan**.

## E2E (Playwright 1.62, Chromium)

```bash
pnpm e2e           # next build + playwright test
```

- El servidor de pruebas arranca `next start` en el puerto 3100 con
  `AUTH_SECRET` de prueba, registro público explícitamente permitido y rate
  limit elevado.
- Chromium se instala **dentro del proyecto**:
  `PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers pnpm exec playwright install chromium`.
- Proyectos: `chromium-mobile-small` (360×800) y `chromium-desktop`.

### Cobertura

| Spec | Flujos |
|---|---|
| `auth.spec.ts` | Google oculto/opt-in, login, ojo de contraseña, recuperación anti-enumeración y rutas privadas |
| `wardrobe.spec.ts` | crear, editar, archivar, clonar, eliminar, búsqueda, filtros por categoría |
| `outfits.spec.ts` | sugerencia guardada offline, builder, lista, calendario y marcar vestido |
| `offline.spec.ts` | online → offline → crear → recargar (persiste) → online → «Sincronizado» |
| `visual.spec.ts` | capturas en móvil/desktop: login, home, armario, detalle, formulario, outfits, calendario |
| `admin-registration.spec.ts` | registro cerrado, login sin «Crear cuenta», invitaciones y gestión de cuentas |
| `profile.spec.ts` | cambios de perfil y foto |

Las capturas se guardan en `tests/e2e/screenshots/` para revisión visual
contra `UI-Reference/`.

Estado conocido: **62 pruebas E2E aprobadas y 4 skips esperados**. Esta cifra no
incluye una nueva ejecución del modelo real de eliminación de fondo: sigue
siendo opt-in y debe repetirse por separado:

```bash
RUN_BACKGROUND_MODEL_E2E=1 PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers \
  pnpm exec playwright test tests/e2e/background-removal.spec.ts \
  --project=chromium-desktop
```

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
