import { getSessionUser } from '@/server/auth/session';
import { jsonOk, unauthorized } from '@/server/http';
import { pullAll } from '@/server/repositories/sync-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  // since opcional: null = pull completo (primera sincronización del dispositivo).
  const result = await pullAll(user.userId, since && !Number.isNaN(Date.parse(since)) ? since : null);
  return jsonOk(result);
}
