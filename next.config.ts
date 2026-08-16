import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Cabeceras de seguridad aplicadas a todas las respuestas.
 *
 * Nota CSP: Next.js App Router necesita scripts inline para el bootstrap de
 * hidratación (self.__next_f). Se permite 'unsafe-inline' en script-src como
 * compromiso documentado (docs/SECURITY.md): la protección XSS principal
 * viene del escapado de React (sin dangerouslySetInnerHTML en el código) y
 * del resto de directivas. Con nonce por middleware las páginas dejarían de
 * ser estáticas; se evaluará en producción real.
 */
function securityHeaders(): Record<string, string> {
  const cloudinaryHost = process.env.CLOUDINARY_CLOUD_NAME
    ? ` https://res.cloudinary.com`
    : '';
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'" + (isProd ? '' : " 'unsafe-eval'"),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: http://localhost:* https://localhost:*${cloudinaryHost}`,
    "font-src 'self' data:",
    "connect-src 'self' https://api.cloudinary.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
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
    remotePatterns: process.env.CLOUDINARY_CLOUD_NAME
      ? [{ protocol: 'https', hostname: 'res.cloudinary.com' }]
      : [],
  },
  async headers() {
    return [{ source: '/:path*', headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })) }];
  },
};

export default nextConfig;
