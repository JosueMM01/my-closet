import {
  googleLinkStatusResponseSchema,
  operationSuccessResponseSchema,
} from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import { isGoogleEnabled } from '@/server/env';
import { jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import {
  findGoogleAccountByUserId,
  unlinkGoogleAccount,
} from '@/server/repositories/auth-accounts-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  if (!isGoogleEnabled()) return jsonError(404, 'Acceso con Google no disponible');
  const account = await findGoogleAccountByUserId(principal.userId);
  return jsonOk(
    googleLinkStatusResponseSchema.parse(
      account
        ? { linked: true, providerEmail: account.providerEmail }
        : { linked: false, providerEmail: null },
    ),
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  if (!isGoogleEnabled()) return jsonError(404, 'Acceso con Google no disponible');
  await unlinkGoogleAccount(principal.userId);
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
