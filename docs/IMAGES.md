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

Cuando la eliminación automática agota sus rutas compatibles, se conserva la
foto normalizada sin transparencia y se habilita el editor manual. La interfaz
lo informa y permite copiar un diagnóstico técnico sin incluir la imagen,
nombre de archivo, EXIF ni datos de cuenta. Una cancelación sí deja la foto
anterior intacta. Cada intento usa un worker nuevo, que se termina al completar,
fallar o cancelar antes de crear el siguiente runtime ONNX.

## Eliminación de fondo local

- `@imgly/background-removal`, `onnxruntime-web` y los datos están fijados a
  las versiones compatibles 1.7.0 / 1.21.0 / 1.7.0.
- La librería se importa dinámicamente dentro del worker solo cuando el toggle
  está activo.
- Los bytes de la foto nunca se envían a IMG.LY ni a otro host. Modelo, runtime
  y manifest se obtienen exclusivamente del mismo origen en
  `/vendor/background-removal/1.7.0-adaptive-v1/`.
- La selección considera adaptador WebGPU real, plataforma, memoria reportada,
  concurrencia, espacio disponible y la ruta que funcionó anteriormente.
- Escritorio con WebGPU estable intenta `gpu/isnet`, luego `cpu/isnet_fp16` y
  `cpu/isnet_quint8`. Android conserva CPU por defecto porque disponer de
  adaptador no demuestra estabilidad del driver; solo reutiliza WebGPU si esa
  ruta ya quedó registrada como exitosa.
- Un móvil medio comienza con `cpu/isnet_fp16` (~84 MB) y baja a
  `cpu/isnet_quint8` (~42 MB). Un dispositivo limitado invierte ese orden.
- Una ruta con dos fallos deja de probarse en cada foto. Solo los fallos de
  descarga o integridad de assets reciben un reintento; memoria, inferencia y
  terminación del worker cambian de ruta después de liberar el worker anterior.
- Cache Storage es best-effort: quedarse sin cuota no invalida una respuesta de
  red correcta. El modelo puede funcionar en esa sesión aunque no quede
  disponible offline.
- El modelo grande nunca forma parte del precache del service worker.

`scripts/prepare-background-removal-assets.mjs` resuelve el tarball oficial,
selecciona los tres modelos y los runtimes WASM+MJS regular/JSEP,
comprueba tamaño y SHA-256 content-addressed de cada chunk, escribe un
`resources.json` podado y copia licencias/avisos. `predev`, `prebuild` y
`pretest` lo ejecutan de forma idempotente. Los binarios generados están
ignorados por Git.

## Compatibilidad y recursos

La inferencia requiere bastante RAM y puede tardar varios minutos en CPU. El
pipeline distingue descarga, integridad de assets, decodificación, memoria
confirmada por ONNX, inferencia y terminación probable por presión de recursos.
No atribuye automáticamente un worker muerto a falta de RAM. WebGPU depende del
navegador, GPU y controlador; Mobile Safari no está certificado para este flujo
y no se afirma compatibilidad garantizada.

No se habilitan COOP/COEP globales: se conserva compatibilidad futura con el
popup de Google y recursos de Cloudinary. Sin `SharedArrayBuffer`, ONNX puede
usar menos paralelismo y ser más lento.

IMG.LY Background Removal se distribuye bajo AGPL; los textos de licencia y
licencias de terceros se copian junto con los assets generados. Un despliegue
debe revisar sus obligaciones de licencia antes de publicarse.

## Sincronización y backend

- Con almacenamiento local, el sync engine sube cada WebP a `POST /api/images`.
  Con Cloudinary obtiene una firma ligada a usuario+UUID, sube directamente al
  CDN y finaliza en `POST /api/images/finalize`.
- LocalImageStorage guarda el blob en SQLite y `GET /api/images/[id]` se puede
  cachear como imagen inmutable.
- `/api/images/sign` es autenticado y el service worker nunca lo cachea.
- El pull incluye metadatos, nunca el binario. Al aplicarlos, IndexedDB conserva
  el blob ya presente; una imagen solo remota se renderiza con `remoteUrl`.
  Para prometer imágenes offline tras un cambio de dispositivo se necesita una
  fase posterior de hidratación de binarios.
- La foto de perfil utiliza este mismo pipeline de navegador (resize + WebP),
  siempre con eliminación de fondo desactivada.
- Cloudinary fue validado extremo a extremo con firma, WebP directo, consulta
  server-side del recurso, persistencia en Neon y limpieza del recurso de
  prueba. Sigue pendiente el garbage collection y la prueba histórica en dos
  dispositivos antes de producción.
