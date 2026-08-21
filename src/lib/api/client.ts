import type { z } from 'zod';
import { apiErrorResponseSchema } from '@/lib/domain/validation';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function parseClientInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiClientError(parsed.error.issues[0]?.message ?? fallback, 400);
  }
  return parsed.data;
}

export async function requestJSON<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'x-requested-with': 'my-closet',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiClientError('Necesitas conexión para completar este cambio', 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(body);
    throw new ApiClientError(
      error.success ? error.data.error : 'No se pudo completar la solicitud',
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError('El servidor devolvió una respuesta inesperada', response.status);
  }
  return parsed.data;
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) };
}
