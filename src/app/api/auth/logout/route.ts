import { destroySession } from '@/server/auth/session';
import { operationSuccessResponseSchema } from '@/lib/domain/validation';
import { jsonOk, requireSameOrigin } from '@/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  await destroySession();
  return jsonOk(operationSuccessResponseSchema.parse({ ok: true }));
}
