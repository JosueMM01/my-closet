import { getSessionUser } from '@/server/auth/session';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { syncPullQuerySchema } from '@/lib/domain/validation';
import { invalidBody, jsonOk, unauthorized } from '@/server/http';
import {
  InvalidPullCursorError,
  pullAll,
} from '@/server/repositories/sync-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const limited = await guardRateLimit(`sync-pull:${user.userId}`, 240);
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = syncPullQuerySchema.safeParse({
    since: url.searchParams.get('since') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return invalidBody();

  try {
    const result = await pullAll(user.userId, parsed.data.since ?? null, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof InvalidPullCursorError) return invalidBody();
    throw error;
  }
}
