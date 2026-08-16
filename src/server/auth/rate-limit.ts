/**
 * Rate limiting en memoria (ventana deslizante por clave).
 * Adecuado para desarrollo y una sola instancia; en producción multi-instancia
 * se reemplazará por un almacén compartido (ver docs/SECURITY.md).
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const previous = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (previous.length >= limit) {
    hits.set(key, previous);
    return false;
  }
  previous.push(now);
  hits.set(key, previous);
  // Limpieza oportunista para no acumular claves viejas.
  if (hits.size > 10_000) {
    for (const [k, times] of hits) {
      if (times.every((t) => t <= windowStart)) hits.delete(k);
    }
  }
  return true;
}

/** Utilidad para tests. */
export function resetRateLimits(): void {
  hits.clear();
}
