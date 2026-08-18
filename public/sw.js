/*
 * Service Worker de My Closet — offline-first real.
 *
 * Estrategias:
 *  - App shell y estáticos de Next (/_next/static): CacheFirst (inmutables).
 *  - Navegaciones: NetworkFirst con fallback a caché y luego a /offline.
 *  - /api/images/*: CacheFirst (fotos procesadas, inmutables por id).
 *  - Otros GET same-origin: StaleWhileRevalidate.
 *  - API de datos (/api/sync, /api/auth): siempre red; el sync engine
 *    reintenta con outbox — nunca se pierden operaciones.
 *
 * Actualización controlada: nueva versión espera SKIP_WAITING (mensaje
 * desde la UI) y la página se recarga al detectar controllerchange.
 * Background Sync: tag "outbox-sync" avisa a los clientes para sincronizar.
 */
const VERSION = 'v3';
const STATIC_CACHE = `mc-static-${VERSION}`;
const RUNTIME_CACHE = `mc-runtime-${VERSION}`;
const IMAGE_CACHE = `mc-images-${VERSION}`;
const OFFLINE_URL = '/offline';

// Shell offline: páginas principales (el contenido real vive en IndexedDB).
const PRECACHE_URLS = [
  '/',
  '/wardrobe',
  '/wardrobe/new',
  '/outfits',
  '/outfits/new',
  '/calendar',
  '/profile',
  OFFLINE_URL,
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Best-effort por URL: un fallo puntual no rompe la instalación.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) await cache.put(url, response);
          } catch {
            /* sin conexión en install: se completará en runtime */
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('mc-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icon');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Caché runtime, luego shell precacheado, luego /offline.
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ??
      (await caches.match(request, { ignoreSearch: true, cacheName: STATIC_CACHE }));
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ??
      new Response('Sin conexión', { status: 503, headers: { 'content-type': 'text/plain' } })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutaciones: red directa + outbox
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API de datos: siempre red (el sync engine gestiona reintentos).
  if (url.pathname.startsWith('/api/sync') || url.pathname.startsWith('/api/auth')) {
    return;
  }

  if (url.pathname.startsWith('/api/images/')) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// Background Sync: pedir a los clientes abiertos que ejecuten el sync engine.
self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox-sync') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'RUN_SYNC' });
        }
      })(),
    );
  }
});
