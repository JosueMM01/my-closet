import { getSessionUser } from '@/server/auth/session';
import { jsonOk } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return jsonOk({ authenticated: false });
  }
  return jsonOk({
    authenticated: true,
    profile: { userId: user.userId, email: user.email, displayName: user.displayName },
  });
}
