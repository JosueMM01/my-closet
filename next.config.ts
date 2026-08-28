import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const usesCloudinary = process.env.IMAGE_PROVIDER === 'cloudinary';

/**
 * Cabeceras de seguridad aplicadas a todas las respuestas.
 *
 * Nota CSP: Next.js App Router necesita scripts inline para el bootstrap de
 * hidratación (self.__next_f). ONNX Runtime 1.21 también genera funciones para
 * enlazar WASM dentro del worker blob de Turbopack. Por eso `unsafe-inline` y
 * `unsafe-eval` son compromisos documentados en docs/SECURITY.md. Los orígenes
 * de red permanecen cerrados y el código no usa dangerouslySetInnerHTML.
 */
function securityHeaders(): Record<string, string> {
  const cloudinaryImageHost = usesCloudinary ? ' https://res.cloudinary.com' : '';
  const cloudinaryApiHost = usesCloudinary ? ' https://api.cloudinary.com' : '';
  const csp = [
    "default-src 'self'",
    // ONNX reconstruye su modulo ESM desde los chunks locales y lo importa
    // mediante una URL blob dentro del worker.
    "script-src 'self' blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: http://localhost:* https://localhost:*${cloudinaryImageHost}`,
    "font-src 'self' data:",
    // El glue ESM de ONNX obtiene el WASM ensamblado desde otra URL blob.
    `connect-src 'self' blob:${cloudinaryApiHost}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
    ...(isProd ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
  };
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  images: {
    // Las fotos de prendas se sirven como blobs locales o vía API propia.
    remotePatterns: usesCloudinary
      ? [{ protocol: 'https', hostname: 'res.cloudinary.com' }]
      : [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })),
      },
      {
        source: '/vendor/background-removal/1.7.0-adaptive-v1/:asset*',
        headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'cache-control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
