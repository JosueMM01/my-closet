# Seguridad

## Sesión y cookies

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

- Contadores compartidos en `rate_limit_buckets` (Neon/PostgreSQL; SQLite local).
  Inserción/incremento y decisión se realizan atómicamente. Ventanas fijas:
  pueden permitir hasta dos cupos alrededor del límite entre ventanas; no son
  ventanas deslizantes. Las claves se guardan con HMAC, sin IP/correo en claro.
- Login: 30 intentos/60 s por IP y 5/60 s por IP+email. Registro: 10/60 s
  por IP (`AUTH_RATE_LIMIT_REGISTER` ajustable). OAuth start: 30/60 s por IP;
  consulta de invitación: 30/60 s por IP. No sustituye autorización ni CSRF.
- Solicitud de recuperación: 5/60 s por IP manteniendo siempre la misma
  respuesta. Consumo de reset: 10/60 s por IP.
- Usuario autenticado: firma/subida local de imágenes 60/60 s, finalize 120/60 s,
  push y pull de sync 240/60 s cada uno; emisión de invitaciones 10/60 s por admin.
  Vercel proporciona la IP; fuera de esa plataforma no se aceptan cabeceras
  arbitrarias del cliente como identidad y se usa un cupo local compartido.
- Fallo de almacenamiento: 503, sin omitir la protección. Recuperación conserva
  su respuesta genérica y no envía correo si no puede consumir el contador.
  Limpieza oportunista de hasta 1000 claves caducadas por minuto/proceso; no
  requiere Redis ni un servicio de pago. El guard no cubre todavía todos los
  endpoints: completar el inventario es parte de 5B.
- La migración `0003_shared_rate_limits.sql` es aditiva. Debe aplicarse antes de
  desplegar el código: sin esa tabla las operaciones protegidas devuelven 503.
  Rollback del código conserva la tabla; no necesita borrar datos de usuarios.

## Validación y autorización

- **Zod** en cada boundary: formularios (cliente), API (servidor),
  payloads de sync por tipo de entidad (`validateEntityPayload`).
- **IDOR**: los upsert de sync verifican `userId`/`grantorId`; entidad ajena
  → `OwnershipError` → operación `invalid` (test de integración lo cubre).
- Respuestas de error genéricas («Correo o contraseña incorrectos»);
  nunca stack traces ni detalles internos.
- Las APIs administrativas vuelven a comprobar en el servidor que la sesión
  sea `ADMIN` y `ACTIVE`; la caché de roles en IndexedDB nunca concede acceso.
- Las invitaciones de cuenta usan token aleatorio generado en servidor y solo
  persisten su hash SHA-256. Se validan correo, expiración, revocación y uso
  único. No son las invitaciones de compartir armario.
- No hay borrado duro de cuentas desde la administración. Desactivar una
  cuenta elimina sus sesiones; las restricciones de base de datos preservan al
  menos un administrador activo y un máximo de dos.
- El registro público parte de `false` en todos los entornos. El login no ofrece
  alta y las cuentas reales requieren un fragmento de invitación de un uso;
  `PUBLIC_REGISTRATION_ENABLED=true` queda limitado a E2E explícitos.

## Recuperación y Google

- La recuperación no permite enumerar cuentas: responde igual para correos
  activos, inexistentes o deshabilitados y oculta errores de entrega.
- Los tokens de reset son aleatorios, duran 30 minutos, se guardan solo como
  SHA-256 y son de un uso. Al consumirlos se rota la contraseña y se eliminan
  todas las sesiones.
- Google Sign-In no crea cuentas ni enlaza por correo implícitamente. Vincular
  exige sesión activa y coincidencia exacta con el correo verificado de Google;
  login exige un `subject` previamente vinculado.
- OAuth usa `state`, PKCE S256 y `nonce`. JOSE valida firma RS256 mediante JWKS,
  emisor, audiencia, expiración, claims y `email_verified=true`. Las cookies de
  flujo son HttpOnly, `SameSite=Lax`, limitadas a la ruta OAuth y a 10 minutos.
- Con `GOOGLE_AUTH_ENABLED=false` no se anuncia el proveedor ni se llama a
  endpoints o JWKS de Google.

## Cabeceras (next.config.ts)

`content-security-policy`, `x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`, `x-frame-options: DENY`,
`permissions-policy`, HSTS en producción.

### Nota sobre `'unsafe-inline'` y `'unsafe-eval'` en script-src

Next.js App Router requiere scripts inline para el bootstrap de hidratación
(`self.__next_f`). Se permite `'unsafe-inline'` como compromiso documentado:
la mitigación principal de XSS es el escapado automático de React (el
código no usa `dangerouslySetInnerHTML`) más el resto de directivas.
Con nonce por middleware las páginas dejarían de ser estáticas; se
reevaluará en producción real.

ONNX Runtime 1.21 genera funciones para enlazar el runtime WASM dentro del
worker `blob:` emitido por Turbopack. Por ello la eliminación de fondo requiere
`'unsafe-eval'` en la CSP del documento. El riesgo se limita manteniendo
`default-src`, `connect-src`, `worker-src`, `object-src` y los proveedores
externos cerrados por defecto. Si ONNX elimina este requisito o el worker pasa
a compilarse fuera de Turbopack, debe retirarse esta excepción.

## Imágenes

- MIME permitido: jpeg/png/webp/heic/heif/avif; límite 15 MB antes de
  procesar y 3 MB tras procesar. El cliente verifica `image/webp`, firma
  RIFF/WEBP, dimensiones <=1080 y tamaño antes de escribir en IndexedDB.
- Los ids de imagen son UUID v4 (inadivinables); sin enumeración.
- El secreto de Cloudinary nunca sale del servidor (firma solo).
- La eliminación de fondo ejecuta ONNX en un Web Worker. Foto, modelo y runtime
  permanecen en el mismo origen; no hay solicitudes a IMG.LY. Los mensajes del
  worker se validan con Zod y cancelar termina inmediatamente el worker.
- CSP permite `unsafe-eval` y `wasm-unsafe-eval` para ONNX, mantiene
  `object-src 'none'` y solo
  añade orígenes Cloudinary con `IMAGE_PROVIDER=cloudinary`. No se aplican
  COOP/COEP globales para no romper popups de Google ni recursos futuros.
- El service worker nunca cachea `/api/images/sign`; solo cachea GET inmutables
  por UUID y assets content-addressed del modelo.

## Aislamiento de cuentas

- Cada operación de outbox conserva `userId`; Dexie solo reclama operaciones e
  imágenes de la cuenta local activa.
- Antes de push o pull, el sync engine compara la identidad de la cookie remota
  con el perfil local. Una diferencia detiene el ciclo sin enviar datos.
- La API rechaza payloads cuyo `userId` o `grantorId` no coincide con la sesión.

## Secretos

- `.env.local` ignorado por Git; `.env.example` sin valores reales.
- Sin secretos en logs, commits, docs ni fixtures. `AUTH_SECRET` de E2E es
  un valor de prueba local explícito.
- `SMTP_PASSWORD` es un secreto solo de servidor: nunca lleva prefijo
  `NEXT_PUBLIC_`, no se expone a la UI ni se escribe en logs.
- `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` se configuran juntos
  solo en `.env.local`. Se usan una vez si `users` está vacía y solo se persiste
  el hash scrypt. Tras crear el administrador deben retirarse ambas del entorno,
  en especial la contraseña; nunca se versionan valores reales.
- Los respaldos usan Secrets de GitHub Actions separados de Vercel. La URL
  directa de Neon, refresh token de Drive, API key de Neon e identidad privada
  age nunca se entregan a la aplicación ni se publican como artefactos.

## Respaldos

- `pg_dump` se ejecuta externamente contra la conexión directa de Neon; no usa
  PgBouncer ni una Function de Vercel.
- El dump se cifra con age antes de subirlo a Drive y se verifica con tamaño,
  MD5 de transporte y SHA-256 del contenido cifrado y original.
- La rotación conserva dos generaciones completas y nunca elimina la más
  antigua antes de completar la nueva pareja archivo/manifiesto.
- La prueba de restauración usa una rama Neon temporal con expiración y limpieza
  final. El workflow no contiene una ruta que restaure automáticamente sobre la
  rama de producción.
- La operación y recuperación se documentan en `docs/BACKUPS.md`.

## Correo y cambios de cuenta

- `EMAIL_PROVIDER=disabled` es el predeterminado y no abre conexiones. El
  modo `capture` guarda los mensajes para desarrollo/pruebas; solo `smtp`
  conecta al proveedor configurado.
- Invitaciones y recuperación necesitan `capture` o SMTP para entregar sus
  enlaces; `disabled` no envía nada. SMTP está planteado para bajo volumen.
- El cambio de correo exige reautenticación con la contraseña actual y rota
  sesiones, pero aún no confirma la propiedad del nuevo buzón. La verificación
  de correo es un requisito pendiente para producción.

## Gestión de errores

- El cliente trata la falta de red como estado normal (badge), no como
  error; 401 de sync → re-autenticación sin pérdida de datos.
