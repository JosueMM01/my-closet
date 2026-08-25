import { cookies } from 'next/headers';
import { z } from 'zod';
import { googlePictureAvailabilitySchema, operationSuccessResponseSchema } from '@/lib/domain/validation';
import {
  clearGooglePictureCookie,
  readGooglePictureCookie,
} from '@/server/auth/google-flow';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ mode: z.enum(['availability', 'content']).default('availability') }).strict();
const MAX_GOOGLE_PICTURE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return invalidBody('Solicitud de imagen no válida');
  const pending = readGooglePictureCookie(await cookies());
  const available = Boolean(pending && pending.userId === principal.userId);
  if (query.data.mode === 'availability') {
    return jsonOk(googlePictureAvailabilitySchema.parse({ available }));
  }
  if (!pending || pending.userId !== principal.userId) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const response = await fetch(pending.pictureUrl, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) {
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return new Response(null, { status: 415, headers: { 'cache-control': 'no-store' } });
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GOOGLE_PICTURE_BYTES) {
    return new Response(null, { status: 413, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(bytes, {
    headers: {
      'cache-control': 'no-store',
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
    },
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  clearGooglePictureCookie(await cookies());
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
