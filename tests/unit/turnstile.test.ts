import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guardTurnstile, turnstileConfiguration } from '@/server/auth/turnstile';

beforeEach(() => {
  vi.stubEnv('TURNSTILE_ENABLED', 'true');
  vi.stubEnv('TURNSTILE_SITE_KEY', 'synthetic-site-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'synthetic-secret-key');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example.test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('desactivado no contacta a Cloudflare', async () => {
  vi.stubEnv('TURNSTILE_ENABLED', 'false');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await guardTurnstile(undefined, 'login')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it('falla cerrado sin claves o sin token y no inicia una petición', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await guardTurnstile(undefined, 'login'))?.status).toBe(403);
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  expect(turnstileConfiguration().config).toBeNull();
  expect((await guardTurnstile('fixture', 'login'))?.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it('verifica acción y hostname y no envía correo, contraseña ni IP', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, action: 'login', hostname: 'preview.example.test' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await guardTurnstile('synthetic-token', 'login')).toBeNull();
  const options = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(String(options.body))).toEqual({ secret: 'synthetic-secret-key', response: 'synthetic-token' });
});
it.each([
  { success: false },
  { success: true, action: 'recovery', hostname: 'preview.example.test' },
  { success: true, action: 'login', hostname: 'foreign.example.test' },
  { success: true },
])('rechaza respuestas negativas o de otro contexto: %j', async result => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  expect((await guardTurnstile('fixture', 'login'))?.status).toBe(403);
});
it.each([null, { success: 'true' }])('respuesta malformada no permite login: %j', async result => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  expect((await guardTurnstile('fixture', 'login'))?.status).toBe(503);
});
it('fallo de red no filtra datos internos', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic-secret-key')));
  const response = await guardTurnstile('fixture', 'login');
  expect(response?.status).toBe(503);
  expect(await response?.text()).not.toContain('synthetic-secret-key');
});
