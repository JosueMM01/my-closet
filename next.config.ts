import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Cabeceras de seguridad aplicadas a todas las respuestas.
 * La CSP permite los orígenes estrictamente necesarios:
 *  - self: app shell, assets y fuentes self-hosted (next/font);
 *  - data:/blob: imágenes procesadas en el navegador;
 *  - Cloudinary solo si está configurado (img-src).
 */
function securityHeaders(): Record<string, string> {
  const cloudinaryHost = process.env.CLOUDINARY_CLOUD_NAME
    ? ` https://res.cloudinary.com`
    : '';
  const csp = [
    "default-src 'self'",
    "script-src 'self'" + (isProd ? '' : " 'unsafe-eval'"),
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
