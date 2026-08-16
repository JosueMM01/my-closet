import { syncPushSchema, validateEntityPayload } from '@/lib/domain/validation';
import type { CalendarEntry, Garment, Outfit, WardrobeShare } from '@/lib/domain/types';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import { OwnershipError, upsertCalendarEntry, upsertGarment, upsertOutfit, upsertWardrobeShare } from '@/server/repositories/sync-repository';

export const runtime = 'nodejs';

interface OperationResult {
  operationId: string;
  status: 'applied' | 'conflict' | 'invalid';
  remote?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getSessionUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = syncPushSchema.safeParse(body);
  if (!parsed.success) return invalidBody();

  const results: OperationResult[] = [];
  for (const op of parsed.data.operations) {
    const validated = validateEntityPayload(op.entityType, op.payload);
    if (!validated.ok) {
      results.push({ operationId: op.operationId, status: 'invalid' });
      continue;
    }
    try {
      let outcome:
        | { status: 'applied'; entity: unknown }
        | { status: 'conflict'; remote: unknown };
      switch (op.entityType) {
        case 'garment':
          outcome = await upsertGarment(user.userId, validated.entity as unknown as Garment);
          break;
        case 'outfit':
          outcome = await upsertOutfit(user.userId, validated.entity as unknown as Outfit);
          break;
        case 'calendarEntry':
          outcome = await upsertCalendarEntry(
            user.userId,
            validated.entity as unknown as CalendarEntry,
          );
          break;
        case 'wardrobeShare':
          outcome = await upsertWardrobeShare(
            user.userId,
            validated.entity as unknown as WardrobeShare,
          );
          break;
      }
      results.push(
        outcome.status === 'applied'
          ? { operationId: op.operationId, status: 'applied' }
          : {
              operationId: op.operationId,
              status: 'conflict',
              remote: outcome.remote as Record<string, unknown>,
            },
      );
    } catch (error) {
      if (error instanceof OwnershipError) {
        results.push({ operationId: op.operationId, status: 'invalid' });
      } else {
        throw error;
      }
    }
  }

  return jsonOk({ results, serverTime: new Date().toISOString() });
}

export function GET() {
  return jsonError(405, 'Método no permitido');
}
