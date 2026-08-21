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

## Registro y administración de cuentas

- `PUBLIC_REGISTRATION_ENABLED` vale `false` por defecto en **todos** los
  entornos. `true` queda reservado para E2E que prueban expresamente el endpoint;
  no es el mecanismo de alta de personas reales.
- El login no muestra «Crear cuenta». Las altas reales parten de una invitación
  administrativa `/register#invite=...`; el navegador extrae y retira el
  fragmento de la barra antes de enviar el token al API.
- Las invitaciones de **cuenta** las crea un administrador desde Perfil. Son
  distintas de los enlaces para compartir un armario: el token lo genera el
  servidor, en la base solo se guarda su SHA-256, expira y se consume una sola
  vez por el mismo correo invitado.
- Puede haber como máximo dos administradores activos y debe quedar al menos
  uno. Un segundo administrador puede promover, transferir o degradar roles
  dentro de esas reglas; no existe borrado duro de cuentas. Las cuentas se
  desactivan y al desactivarlas se revocan sus sesiones.
- La administración y el correo requieren conexión. La lista de cuentas e
  invitaciones es una caché de lectura en IndexedDB para consulta offline,
  pero el rol local nunca autoriza una API del servidor.

### Bootstrap del primer administrador

`BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` forman un grupo: configurar
solo una hace fallar la validación. Al iniciar SQLite, se usan únicamente si
`users` está vacía; se crea el administrador activo del slot 1 y solo queda en
la base el hash scrypt de la contraseña. Arranques posteriores no crean ni
modifican cuentas.

La persona propietaria debe escribir sus valores elegidos solo en `.env.local`
(ignorado por Git), iniciar una vez y retirar las dos variables cuando el
administrador ya exista, especialmente `BOOTSTRAP_ADMIN_PASSWORD`. Dejarlas a
medias invalida la configuración. Nunca se deben poner valores reales en Git,
logs, documentación o fixtures.

## Endpoints

| Ruta | Método | Notas |
|---|---|---|
| `/api/auth/register` | POST | invitación obligatoria salvo flag E2E explícito; valida Zod y aplica rate limit |
| `/api/auth/login` | POST | 401 genérico; throttle 5/60 s por IP+email |
| `/api/auth/logout` | POST | borra la sesión y la cookie |
| `/api/auth/session` | GET | `{authenticated, profile}` |
| `/api/auth/providers` | GET | `{credentials:true, google:boolean}` según env |
| `/api/auth/forgot-password` | POST | respuesta genérica y rate limit, exista o no la cuenta |
| `/api/auth/reset-password` | POST | consume el token y cambia la contraseña |
| `/api/auth/google/start` | GET | inicia login o vinculación OAuth cuando está habilitado |
| `/api/auth/google/callback` | GET | valida OAuth y crea sesión solo para una identidad vinculada |

Las rutas `/api/profile`, `/api/profile/password` y `/api/profile/email`
actualizan, respectivamente, nombre/foto, contraseña y correo. Las rutas
`/api/admin/*` requieren una sesión de administrador activa en el servidor.

## Recuperación de contraseña

- «Olvidé mi contraseña» siempre responde que se enviará un enlace si existe
  una cuenta activa. No revela existencia, estado, fallo de almacenamiento ni
  error de entrega.
- Cada solicitud sustituye el token anterior. El token aleatorio vence en 30
  minutos, se usa una sola vez y en SQLite solo se persiste su SHA-256.
- El enlace lleva el token en el fragmento `#token=...`; la pantalla lo retira
  de la URL. Un reset válido actualiza el hash scrypt y revoca todas las
  sesiones del usuario.
- La entrega requiere `EMAIL_PROVIDER=capture` para pruebas o `smtp` para correo
  real. `disabled` no abre conexiones ni envía nada.

Todos los campos de contraseña de login, registro por invitación, Perfil y reset
incluyen un control de ojo accesible para mostrar u ocultar el valor sin enviar
el formulario.

## Google Sign-In (implementado, opt-in)

El proveedor solo se anuncia con `GOOGLE_AUTH_ENABLED=true`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `NEXT_PUBLIC_APP_URL` válidos. Si
está desactivado no aparece UI ni se realiza ninguna llamada a Google.

Google no registra ni vincula automáticamente. Primero debe existir una cuenta
con contraseña creada por invitación; con sesión activa, la persona vincula
desde Perfil una identidad cuyo correo de Google sea verificado y coincida
exactamente, tras normalización, con el correo del perfil. El login de Google
solo acepta después el `subject` ya vinculado y una cuenta activa.

El flujo usa `state` comparado en tiempo constante, PKCE S256, `nonce` y cookies
HttpOnly transitorias de 10 minutos. El servidor intercambia el código y valida
el ID token con JOSE/JWKS: firma RS256, emisor, audiencia, expiración, claims,
`email_verified=true` y `nonce`. Los tokens de Google no se guardan en el
navegador; la sesión final sigue usando `mc_session`.

## Sesión offline

- Tras el primer login, el perfil local permite abrir y usar la app sin
  conexión (IndexedDB no requiere sesión de red).
- El proveedor de sesión consulta `/api/auth/session` cada 5 min (si hay red). Con 401
  se marca `remoteExpired`: banner en perfil, **sin borrar datos ni outbox**;
  el usuario re-autentica y el sync continúa donde estaba.
- Cerrar sesión conserva los datos del dispositivo (particionados por
  `userId`); otro usuario puede iniciar sesión en el mismo navegador.

## Cambios de credenciales

- Cambiar contraseña o correo exige la contraseña actual y rota todas las
  sesiones del usuario.
- El cambio de correo **no verifica todavía** la propiedad del nuevo buzón.
  Es una limitación conocida y la verificación por correo es obligatoria antes
  de producción.

## Persistencia y dialectos

`auth_accounts` y `password_reset_tokens` están declaradas en los esquemas y
migraciones SQL de SQLite y PostgreSQL. El flujo operativo actual usa SQLite;
los repositorios runtime de PostgreSQL/Neon siguen pendientes.

## Passkeys / WebAuthn (preparado)

El diseño de sesión (cookie opaca server-side + perfil local sin secretos)
es compatible con añadir WebAuthn como método de login/2FA posterior sin
cambiar el modelo: un nuevo registro en `users`/credenciales produciría la
misma cookie de sesión. La PWA usa autenticación del sistema (huella/Face
ID/Windows Hello/PIN) cuando el navegador la ofrezca; no accede a
biometría directamente.
