# Autenticación

## Modelo

- **Email + contraseña** contra `/api/auth/register|login` (backend local
  SQLite en desarrollo; Neon PostgreSQL en producción futura).
- Contraseñas: **scrypt** (N=16384, 64 bytes, sal aleatoria por usuario),
  comparación `timingSafeEqual`. Nunca se registran en logs.
- **Sesión server-side**: tabla `sessions` guarda `sha256(token)` + expiración
  (30 días). La cookie `mc_session` lleva `sha256(token).hmac(..., AUTH_SECRET)`
  con `HttpOnly; SameSite=Lax; Path=/; Secure` (producción).
- **Nada de tokens en localStorage/sessionStorage/IndexedDB.** El cliente
  persiste solo un perfil local sin secretos (`kv` → `local-profile`).

## Endpoints

| Ruta | Método | Notas |
|---|---|---|
| `/api/auth/register` | POST | valida Zod; 409 si el email existe; rate limit |
| `/api/auth/login` | POST | 401 genérico; throttle 5/60 s por IP+email |
| `/api/auth/logout` | POST | borra la sesión y la cookie |
| `/api/auth/session` | GET | `{authenticated, profile}` |
| `/api/auth/providers` | GET | `{credentials:true, google:boolean}` según env |

## Google Sign-In (preparado, desactivado)

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ausentes → el botón no se muestra
(`/api/auth/providers` devuelve `google:false`). Al configurarlos, el flujo
a implementar es OAuth 2.0 con code exchange **en el servidor**: el access
token de Google nunca llega al navegador; la sesión resultante usa la misma
cookie actual. Ver docs/EXTERNAL_SERVICES_SETUP.md.

## Sesión offline

- Tras el primer login, el perfil local permite abrir y usar la app sin
  conexión (IndexedDB no requiere sesión de red).
- El providers chequean `/api/auth/session` cada 5 min (si hay red). Con 401
  se marca `remoteExpired`: banner en perfil, **sin borrar datos ni outbox**;
  el usuario re-autentica y el sync continúa donde estaba.
- Cerrar sesión conserva los datos del dispositivo (particionados por
  `userId`); otro usuario puede iniciar sesión en el mismo navegador.

## Passkeys / WebAuthn (preparado)

El diseño de sesión (cookie opaca server-side + perfil local sin secretos)
es compatible con añadir WebAuthn como método de login/2FA posterior sin
cambiar el modelo: un nuevo registro en `users`/credenciales produciría la
misma cookie de sesión. La PWA usa autenticación del sistema (huella/Face
ID/Windows Hello/PIN) cuando el navegador la ofrezca; no accede a
biometría directamente.
