import { accountProfileSchema, profileUpdateSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { ProfileUpdateError, updateProfile } from '@/server/repositories/users-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return jsonOk(
    accountProfileSchema.parse({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      role: user.role,
      status: user.status,
      profileImageId: user.profileImageId,
    }),
  );
}

export async function PATCH(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody('Datos de perfil inválidos');
  try {
    const updated = await updateProfile(user.userId, parsed.data);
    if (!updated || updated.status !== 'ACTIVE') return unauthorized();
    return jsonOk(
      accountProfileSchema.parse({
        userId: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        createdAt: updated.createdAt,
        role: updated.role,
        status: updated.status,
        profileImageId: updated.profileImageId,
      }),
    );
  } catch (error) {
    if (error instanceof ProfileUpdateError) {
      return Response.json(
        { error: error.message },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }
    throw error;
  }
}
