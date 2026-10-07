import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { and, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getServerDB, pgSchema, sqliteSchema, type ServerDB } from '@/server/db';
import { getAuthSecret } from '@/server/env';
import { jsonError } from '@/server/http';

const optionsSchema = z.object({
  key: z.string().min(1).max(1024), limit: z.number().int().min(1).max(100_000),
  windowMs: z.number().int().min(1_000).max(86_400_000),
});
let lastCleanupAt = 0; // Solo optimiza limpieza; nunca decide permisos entre instancias.

/** Fuera de Vercel no confiar en cabeceras de IP enviadas por el cliente. */
export function requestRateLimitIdentity(request: Request): string {
  if (process.env.VERCEL !== '1') return 'local';
  const ip = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for'))?.split(',')[0]?.trim();
  return ip && isIP(ip) ? ip.toLowerCase() : 'unknown';
}

/** Ventana fija compartida, incremento/decisión atómicos y claves HMAC sin IP/correo en BD. */
export async function rateLimit(key: string, limit: number, windowMs: number, database?: ServerDB): Promise<boolean> {
  optionsSchema.parse({ key, limit, windowMs });
  const now = Date.now();
  const expiresAt = Math.floor(now / windowMs) * windowMs + windowMs;
  const keyHash = createHmac('sha256', getAuthSecret()).update(JSON.stringify([key, limit, windowMs])).digest('hex');
  const db = database ?? await getServerDB();
  if (db.dialect === 'postgres') {
    const table = pgSchema.rateLimitBuckets;
    const rows = await db.postgres.insert(table).values({ keyHash, hits: 1, expiresAt })
      .onConflictDoUpdate({ target: table.keyHash, set: {
        hits: sql`CASE WHEN ${table.expiresAt} <= ${now} THEN 1 ELSE ${table.hits} + 1 END`,
        expiresAt: sql`CASE WHEN ${table.expiresAt} <= ${now} THEN ${expiresAt} ELSE ${table.expiresAt} END`,
      }, setWhere: sql`${table.expiresAt} <= ${now} OR ${table.hits} < ${limit}` })
      .returning({ hits: table.hits });
    if (now - lastCleanupAt > 60_000) {
      lastCleanupAt = now;
      const expired = await db.postgres.select({ keyHash: table.keyHash }).from(table)
        .where(lte(table.expiresAt, now)).limit(1000);
      if (expired.length) await db.postgres.delete(table).where(and(lte(table.expiresAt, now), inArray(table.keyHash, expired.map(row => row.keyHash))));
    }
    return rows.length === 1;
  }
  const table = sqliteSchema.rateLimitBuckets;
  const rows = db.sqlite.insert(table).values({ keyHash, hits: 1, expiresAt })
    .onConflictDoUpdate({ target: table.keyHash, set: {
      hits: sql`CASE WHEN ${table.expiresAt} <= ${now} THEN 1 ELSE ${table.hits} + 1 END`,
      expiresAt: sql`CASE WHEN ${table.expiresAt} <= ${now} THEN ${expiresAt} ELSE ${table.expiresAt} END`,
    }, setWhere: sql`${table.expiresAt} <= ${now} OR ${table.hits} < ${limit}` })
    .returning({ hits: table.hits }).all();
  if (now - lastCleanupAt > 60_000) {
    lastCleanupAt = now;
    const expired = db.sqlite.select({ keyHash: table.keyHash }).from(table).where(lte(table.expiresAt, now)).limit(1000).all();
    if (expired.length) db.sqlite.delete(table).where(and(lte(table.expiresAt, now), inArray(table.keyHash, expired.map(row => row.keyHash)))).run();
  }
  return rows.length === 1;
}

/** Fail-closed: distinguir almacenamiento no disponible de límite realmente alcanzado. */
export async function guardRateLimit(key: string, limit: number, windowMs = 60_000): Promise<Response | null> {
  try {
    return await rateLimit(key, limit, windowMs) ? null : jsonError(429, 'Demasiados intentos; espera un momento');
  } catch {
    return jsonError(503, 'La protección de acceso no está disponible. Vuelve a intentarlo más tarde.');
  }
}

/** Tests locales únicamente: nunca se puede vaciar el contador de producción. */
export async function resetRateLimits(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') throw new Error('Reset de rate limit solo permitido en tests');
  const db = await getServerDB();
  if (db.dialect !== 'sqlite') throw new Error('Reset de rate limit solo permitido en SQLite de tests');
  db.sqlite.delete(sqliteSchema.rateLimitBuckets).run();
  lastCleanupAt = 0;
}
