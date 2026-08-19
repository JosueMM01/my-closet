# Imágenes

## Pipeline del navegador

```text
imagen original (JPEG/HEIC/PNG/WebP/AVIF, <= 15 MB)
  -> validar MIME y tamaño
  -> Web Worker de una operación
  -> createImageBitmap (orientación EXIF) y resize <= 1080 px
  -> opcional: quitar fondo con ONNX en el mismo navegador
  -> WebP transparente, validación de firma RIFF/WEBP y <= 3 MB
  -> IndexedDB (images), syncStatus "pending"
```

La ruta normal de resize/WebP no importa ni carga IMG.LY u ONNX. Si el worker
normal falla, usa el mismo procesador en el hilo principal con
`OffscreenCanvas` o canvas DOM. Los bitmaps se cierran en `finally`.

Cuando se solicita quitar el fondo no se devuelve silenciosamente el original:
un error o una cancelación deja la foto anterior intacta. Cada intento usa un
worker nuevo, que se termina al completar, fallar o cancelar para liberar la
sesión y cientos de MB de memoria.

## Eliminación de fondo local

- `@imgly/background-removal`, `onnxruntime-web` y los datos están fijados a
  las versiones compatibles 1.7.0 / 1.21.0 / 1.7.0.
- La librería se importa dinámicamente dentro del worker solo cuando el toggle
  está activo.
- Los bytes de la foto nunca se envían a IMG.LY ni a otro host. Modelo, runtime
  y manifest se obtienen exclusivamente del mismo origen en
  `/vendor/background-removal/1.7.0/`.
- Orden de intentos: WebGPU + `isnet` completo si el navegador expone WebGPU;
  CPU + `isnet`; CPU + `isnet_fp16` como fallback de compatibilidad. Cada
  fallback queda aislado en un worker nuevo para no reutilizar un runtime ONNX
  inicializado a medias.
- El primer intento con `isnet` descarga aproximadamente 200 MB decimales
  (la interfaz advierte cerca de 210 MB). `isnet_fp16` requiere unos 88 MB si
  se usa el fallback. El service worker los guarda con CacheFirst en una caché
  versionada separada que no se elimina con versiones ordinarias del app shell.
- El modelo grande nunca forma parte del precache del service worker.

`scripts/prepare-background-removal-assets.mjs` resuelve el tarball oficial,
selecciona únicamente ambos modelos y los runtimes WASM+MJS regular/JSEP,
comprueba tamaño y SHA-256 content-addressed de cada chunk, escribe un
`resources.json` podado y copia licencias/avisos. `predev`, `prebuild` y
`pretest` lo ejecutan de forma idempotente. Los binarios generados están
ignorados por Git.

## Compatibilidad y recursos

La inferencia requiere mucha RAM y puede tardar varios minutos en CPU. Algunos
teléfonos cerrarán el worker por presión de memoria; en ese caso se informa el
fallo y se puede desactivar la opción. WebGPU depende del navegador, GPU y
controlador. Mobile Safari no está certificado para este flujo y no se afirma
compatibilidad garantizada.

No se habilitan COOP/COEP globales: se conserva compatibilidad futura con el
popup de Google y recursos de Cloudinary. Sin `SharedArrayBuffer`, ONNX puede
usar menos paralelismo y ser más lento.

IMG.LY Background Removal se distribuye bajo AGPL; los textos de licencia y
licencias de terceros se copian junto con los assets generados. Un despliegue
debe revisar sus obligaciones de licencia antes de publicarse.

## Sincronización y backend

- El sync engine sube cada WebP pendiente a `POST /api/images` con límite de
  3 MB ya validado antes de persistir.
- LocalImageStorage guarda el blob en SQLite y `GET /api/images/[id]` se puede
  cachear como imagen inmutable.
- `/api/images/sign` es autenticado y el service worker nunca lo cachea.
- Cloudinary solo se habilita explícitamente con
  `IMAGE_PROVIDER=cloudinary` y sus credenciales. En ese modo futuro, la subida
  será directa y la firma seguirá siendo del servidor.
