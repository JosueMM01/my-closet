import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/server/env';
import { jsonError } from '@/server/http';
import { processImageDeletionJobs } from '@/server/services/account-deletion-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  if (!env.ACCOUNT_DELETION_ENABLED || !env.ACCOUNT_DELETION_WORKER_SECRET || env.ACCOUNT_DELETION_WORKER_SECRET.length < 32) {
    return jsonError(404, 'No disponible');
  }
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.ACCOUNT_DELETION_WORKER_SECRET}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return jsonError(401, 'No autorizado');
  const result = await processImageDeletionJobs({ limit: 3 });
  return Response.json(result, { status: result.failed || result.blocked || result.deferred ? 503 : 200, headers: { 'cache-control': 'no-store' } });
}
