import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeServerDB, getServerDB, sqliteSchema } from '@/server/db';
import { guardRateLimit, rateLimit, requestRateLimitIdentity, resetRateLimits } from '@/server/auth/rate-limit';

beforeEach(async () => {
  await closeServerDB();
  vi.stubEnv('DATABASE_PROVIDER', 'sqlite');
  vi.stubEnv('DATABASE_URL', 'file::memory:');
  vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', '');
  vi.stubEnv('BOOTSTRAP_ADMIN_PASSWORD', '');
  vi.stubEnv('AUTH_SECRET', 'synthetic-rate-limit-secret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(async () => { await closeServerDB(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('límites compartidos persistidos', () => {
  it('arranque concurrente no crea bases/pools distintos ni excede el cupo', async () => {
    const attempts = await Promise.all(Array.from({ length: 30 }, () => rateLimit('login:fixture@example.test', 5, 60_000)));
    expect(attempts.filter(Boolean)).toHaveLength(5);
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Fixture SQLite requerida');
    const rows = db.sqlite.select().from(sqliteSchema.rateLimitBuckets).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hits).toBe(5);
    expect(rows[0]?.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('fixture@example.test');
  });

  it('reiniciar el módulo del limitador no reinicia la ventana compartida', async () => {
    await rateLimit('fixture', 1, 60_000);
    vi.resetModules();
    // Solo cargar el consumidor: usa el almacén ya abierto a través de una dependencia mock.
    const db = await getServerDB();
    vi.doMock('@/server/db', async importOriginal => ({ ...await importOriginal<typeof import('@/server/db')>(), getServerDB: async () => db }));
    try {
      const second = await import('@/server/auth/rate-limit');
      expect(await second.rateLimit('fixture', 1, 60_000)).toBe(false);
    } finally { vi.doUnmock('@/server/db'); }
  });

  it('reinicia una ventana vencida sin acumular intentos rechazados', async () => {
    expect(await rateLimit('fixture', 1, 60_000)).toBe(true);
    expect(await rateLimit('fixture', 1, 60_000)).toBe(false);
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    expect(await rateLimit('fixture', 1, 60_000)).toBe(true);
  });

  it('devuelve 429 si alcanzó el límite y 503 si el almacén falla, sin detalles internos', async () => {
    expect(await guardRateLimit('fixture', 1)).toBeNull();
    expect((await guardRateLimit('fixture', 1))?.status).toBe(429);
    const db = await getServerDB();
    if (db.dialect !== 'sqlite') throw new Error('Fixture SQLite requerida');
    db.raw.exec('DROP TABLE rate_limit_buckets'); // Solo memoria sintética del test.
    const unavailable = await guardRateLimit('fixture', 1);
    expect(unavailable?.status).toBe(503);
    expect(await unavailable?.text()).not.toContain('rate_limit_buckets');
  });

  it('la utilidad de reset no puede operar en runtime de producción', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(resetRateLimits()).rejects.toThrow('solo permitido en tests');
  });

  it('no usa IP arbitraria fuera de Vercel, valida la cabecera del proxy confiable', () => {
    vi.stubEnv('VERCEL', '');
    const request = new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.10', 'x-vercel-forwarded-for': '203.0.113.11' } });
    expect(requestRateLimitIdentity(request)).toBe('local');
    vi.stubEnv('VERCEL', '1');
    expect(requestRateLimitIdentity(request)).toBe('203.0.113.11');
    expect(requestRateLimitIdentity(new Request('http://localhost', { headers: { 'x-forwarded-for': 'not-an-ip' } }))).toBe('unknown');
  });
});
