import { adminUsersResponseSchema } from '@/lib/domain/validation';
import { requireAdmin } from '@/server/auth/session';
import { authGuardError, jsonError, jsonOk } from '@/server/http';
import { listUsersForAdmin } from '@/server/repositories/admin-users-repository';
import { AdminAuthorizationError } from '@/server/repositories/invitations-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin();
    const users = (await listUsersForAdmin(admin.userId)).map((user) => ({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      adminSlot: user.adminSlot,
      profileImageId: user.profileImageId,
      createdAt: user.createdAt,
    }));
    return jsonOk(adminUsersResponseSchema.parse({ users }));
  } catch (error) {
    const guardResponse = authGuardError(error);
    if (guardResponse) return guardResponse;
    if (error instanceof AdminAuthorizationError) return jsonError(403, error.message);
    throw error;
  }
}
