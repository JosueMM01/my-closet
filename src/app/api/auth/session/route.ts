import { getSessionUser } from '@/server/auth/session';
import { sessionResponseSchema } from '@/lib/domain/validation';
import { jsonOk } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return jsonOk(sessionResponseSchema.parse({ authenticated: false }));
  }
  return jsonOk(
    sessionResponseSchema.parse({
      authenticated: true,
      profile: {
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        role: user.role,
        status: user.status,
        profileImageId: user.profileImageId,
      },
    }),
  );
}
