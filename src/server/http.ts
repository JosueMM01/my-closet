/**
 * Utilidades HTTP comunes de la API: validación anti-CSRF por Origin,
 * respuestas JSON uniformes y manejo de errores sin filtrar internos.
 */
import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Protección CSRF para mutaciones: el header Origin debe coincidir con el
 * host de la petición (o con NEXT_PUBLIC_APP_URL configurado).
 * Combinado con SameSite=Lax de las cookies.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // llamadas no-browser (tests, scripts propios)
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get('host');
    if (host && originUrl.host === host) return true;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && originUrl.toString() === new URL(appUrl).toString()) return true;
    return false;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: Request): NextResponse | null {
  if (!isSameOrigin(request)) {
    return jsonError(403, 'Origen no permitido');
  }
  return null;
}

/** Respuesta 401 estándar para sesiones inválidas/expiradas. */
export function unauthorized(): NextResponse {
  return jsonError(401, 'No autenticado o sesión expirada');
}

/** Convierte errores Zod en respuesta 400 sin detalles internos. */
export function invalidBody(message = 'Datos inválidos'): NextResponse {
  return jsonError(400, message);
}
