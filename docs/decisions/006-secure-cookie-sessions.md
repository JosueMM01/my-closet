# ADR-006: Sesiones server-side con cookie HttpOnly firmada

## Status
Accepted

## Context
Prohibido guardar tokens en localStorage/sessionStorage/IndexedDB. La sesión
debe sobrevivir offline sin secretos en el cliente.

## Decision
- Sesiones **server-side**: la cookie `mc_session` contiene
  `sha256(token).hmac(sha256(token), AUTH_SECRET)`. En la BD solo se guarda
  el `sha256(token)` con expiración (30 días).
- Cookie: `HttpOnly; SameSite=Lax; Path=/; Secure` (en producción);
  el token nunca es accesible a JS.
- El cliente solo persiste un **perfil local sin secretos** (userId, email,
  nombre) en IndexedDB para saber quién es sin conexión.
- CSRF: chequeo de `Origin` en todas las mutaciones + `SameSite=Lax`.
- Rate limiting en memoria para login (5/60 s por IP+email) y registro
  (10/60 s por IP, ajustable con `AUTH_RATE_LIMIT_REGISTER`).
- Contraseñas: scrypt (N=16384, 64 bytes) con sal aleatoria y comparación
  timing-safe.
- Alta pública desactivada por defecto en todos los entornos. Las cuentas reales
  se crean mediante invitaciones con token hash-only; el bootstrap inicial exige
  email+contraseña juntos, solo actúa con `users` vacía y persiste scrypt.
- Reset: respuesta anti-enumeración, token SHA-256 de un uso durante 30 minutos
  y revocación de todas las sesiones tras cambiar la contraseña.
- Google es opt-in y no crea ni enlaza cuentas. La vinculación exige correo
  verificado exacto; OAuth usa state, PKCE, nonce y validación JOSE del ID token.

## Consequences
- Expiración remota ≠ pérdida de datos: la app sigue funcionando offline y
  el sync reanuda tras re-login (los pendientes se conservan).
- Passkeys/WebAuthn: el diseño de sesión es compatible con añadir un
  segundo factor/credencial más adelante sin cambiar la cookie.
- Correo y Google no realizan llamadas externas cuando sus selectores están
  desactivados. `EMAIL_PROVIDER=disabled` tampoco entrega enlaces.
