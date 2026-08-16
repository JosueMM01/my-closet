# Seguridad

## Sesión y cookies (ADR-006)

- Cookie `mc_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` en
  producción, 30 días. Valor: `sha256(token) + HMAC(AUTH_SECRET)`; en BD
  solo `sha256(token)`.
- **Prohibido y verificado**: ningún token en localStorage,
  sessionStorage o IndexedDB. Búsqueda de `localStorage.setItem.*token`
  → 0 resultados.
- `AUTH_SECRET` obligatorio en producción (fallo de arranque si falta).

## CSRF

- Chequeo de `Origin` contra `Host`/`NEXT_PUBLIC_APP_URL` en todas las
  mutaciones (`requireSameOrigin`, `src/server/http.ts`).
- `SameSite=Lax` + custom header `x-requested-with` en fetch del cliente.

## Rate limiting

- Login: 5 intentos/60 s por IP+email. Registro: 10/60 s por IP
  (`AUTH_RATE_LIMIT_REGISTER` ajustable). In-memory: adecuado para una
  instancia; en multi-instancia mover a almacén compartido (pendiente).

## Validación y autorización

- **Zod** en cada boundary: formularios (cliente), API (servidor),
  payloads de sync por tipo de entidad (`validateEntityPayload`).
- **IDOR**: los upsert de sync verifican `userId`/`grantorId`; entidad ajena
  → `OwnershipError` → operación `invalid` (test de integración lo cubre).
- Respuestas de error genéricas («Correo o contraseña incorrectos»);
  nunca stack traces ni detalles internos.

## Cabeceras (next.config.ts)

`content-security-policy`, `x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`, `x-frame-options: DENY`,
`permissions-policy`, HSTS en producción.

### Nota sobre `'unsafe-inline'` en script-src

Next.js App Router requiere scripts inline para el bootstrap de hidratación
(`self.__next_f`). Se permite `'unsafe-inline'` como compromiso documentado:
la mitigación principal de XSS es el escapado automático de React (el
código no usa `dangerouslySetInnerHTML`) más el resto de directivas.
Con nonce por middleware las páginas dejarían de ser estáticas; se
reevaluará en producción real.

## Imágenes

- MIME permitido: jpeg/png/webp/heic/heif/avif; límite 15 MB antes de
  procesar y 3 MB tras procesar (413/415 si excede).
- Los ids de imagen son UUID v4 (inadivinables); sin enumeración.
- El secreto de Cloudinary nunca sale del servidor (firma solo).

## Secretos

- `.env.local` ignorado por Git; `.env.example` sin valores reales.
- Sin secretos en logs, commits, docs ni fixtures. `AUTH_SECRET` de E2E es
  un valor de prueba local explícito.

## Gestión de errores

- El cliente trata la falta de red como estado normal (badge), no como
  error; 401 de sync → re-autenticación sin pérdida de datos.
