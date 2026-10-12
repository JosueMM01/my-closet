import 'server-only';
import { z } from 'zod';
import { jsonError } from '@/server/http';

const configSchema = z.object({
  siteKey: z.string().trim().min(1).max(200),
  secretKey: z.string().trim().min(1).max(200),
  appUrl: z.url(),
});
const resultSchema = z.object({
  success: z.boolean(), hostname: z.string().optional(), action: z.string().optional(),
});

export function turnstileConfiguration() {
  const enabled = process.env.TURNSTILE_ENABLED === 'true';
  const parsed = configSchema.safeParse({
    siteKey: process.env.TURNSTILE_SITE_KEY,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  return { enabled, config: parsed.success ? parsed.data : null };
}

/** No tokens/logs persistidos. La validación real de uso único pertenece a Siteverify. */
export async function guardTurnstile(token: string | undefined, action: 'login' | 'recovery') {
  const { enabled, config } = turnstileConfiguration();
  if (!enabled) return null;
  if (!config) return jsonError(503, 'La verificación de seguridad no está configurada.');
  if (!token) return jsonError(403, 'Completa la verificación de seguridad para continuar.');
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) return jsonError(503, 'La verificación de seguridad no está disponible. Intenta de nuevo.');
    const result = resultSchema.safeParse(await response.json());
    if (!result.success) return jsonError(503, 'No se pudo comprobar la verificación de seguridad.');
    if (!result.data.success || result.data.action !== action ||
        result.data.hostname !== new URL(config.appUrl).hostname) {
      return jsonError(403, 'La verificación de seguridad venció o no es válida. Intenta de nuevo.');
    }
    return null;
  } catch {
    return jsonError(503, 'La verificación de seguridad no está disponible. Revisa la conexión e intenta de nuevo.');
  }
}
