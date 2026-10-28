import { cookies } from 'next/headers';
import { accountDeletionInputSchema, accountDeletionResponseSchema, accountDeletionStatusSchema } from '@/lib/domain/validation';
import { getEnv, getGoogleAuthConfig, isProduction } from '@/server/env';
import { jsonError, requireSameOrigin, unauthorized } from '@/server/http';
import { getSessionUser, SESSION_COOKIE } from '@/server/auth/session';
import { guardRateLimit } from '@/server/auth/rate-limit';
import { verifyPassword } from '@/server/auth/password';
import { clearDeletionProofCookie, DELETION_PROOF_COOKIE, deletionSessionBinding } from '@/server/auth/account-deletion';
import { AccountDeletionError, deleteOwnAccount, validDeletionProof } from '@/server/repositories/account-deletion-repository';
import { credentialFingerprint } from '@/server/repositories/email-change-repository';
import { findUserById } from '@/server/repositories/users-repository';
import { findGoogleAccountByUserId } from '@/server/repositories/auth-accounts-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const enabled = getEnv().ACCOUNT_DELETION_ENABLED;
  const store = await cookies();
  const binding = deletionSessionBinding(store.get(SESSION_COOKIE)?.value);
  return Response.json(accountDeletionStatusSchema.parse({
    enabled,
    googleAvailable: enabled && !!getGoogleAuthConfig() && !!await findGoogleAccountByUserId(principal.userId),
    reauthenticated: enabled && await validDeletionProof(principal.userId, store.get(DELETION_PROOF_COOKIE)?.value, binding.sessionHash),
  }), { headers: { 'cache-control': 'no-store' } });
}

export async function DELETE(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!getEnv().ACCOUNT_DELETION_ENABLED) return jsonError(404, 'La baja de cuentas todavía no está habilitada');
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const limited = await guardRateLimit(`account-deletion:${principal.userId}`, 5);
  if (limited) return limited;
  const parsed = accountDeletionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'Confirma las consecuencias e introduce una credencial válida');
  const store = await cookies();
  const binding = deletionSessionBinding(store.get(SESSION_COOKIE)?.value);
  const user = await findUserById(principal.userId);
  if (!user || user.status !== 'ACTIVE') return unauthorized();
  let credentialHash: string | undefined;
  if (parsed.data.currentPassword) {
    if (!await verifyPassword(parsed.data.currentPassword, user.passwordHash)) return jsonError(403, 'La contraseña actual es incorrecta');
    credentialHash = credentialFingerprint(user.passwordHash);
  }
  try {
    const result = await deleteOwnAccount({ userId: user.id, ...binding, credentialHash,
      googleProof: credentialHash ? undefined : store.get(DELETION_PROOF_COOKIE)?.value });
    clearDeletionProofCookie(store);
    store.set(SESSION_COOKIE, '', { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/', maxAge: 0 });
    return Response.json(accountDeletionResponseSchema.parse(result), { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccountDeletionError) return jsonError(error.status, error.message);
    return jsonError(503, 'No se pudo completar la baja. Conservamos la cuenta si la transacción no se confirmó.');
  }
}
