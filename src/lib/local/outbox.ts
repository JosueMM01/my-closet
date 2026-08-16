/**
 * Outbox: cola local de operaciones pendientes de sincronización.
 * Nunca se descarta una operación por fallos de red.
 */
import type { OutboxEntityType, OutboxOperation, OutboxOperationType } from '@/lib/domain/types';
import { uuid } from '@/lib/domain/ids';
import { getDB } from './db';

export interface EnqueueInput {
  entityType: OutboxEntityType;
  entityId: string;
  operation: OutboxOperationType;
  payload: unknown;
}

export async function enqueueOperation(input: EnqueueInput): Promise<void> {
  const op: OutboxOperation = {
    operationId: uuid(),
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  };
  await getDB().outbox.put(op);
}

/**
 * Toma hasta `limit` operaciones pendientes marcándolas `syncing`.
 * Devuelve las operaciones con su snapshot para enviar al servidor.
 */
export async function claimPendingOperations(
  limit: number,
): Promise<OutboxOperation[]> {
  const db = getDB();
  return db.transaction('rw', db.outbox, async () => {
    const candidates = await db.outbox
      .where('status')
      .anyOf(['pending', 'failed'])
      .limit(limit)
      .toArray();
    const claimed: OutboxOperation[] = [];
    for (const op of candidates) {
      const updated: OutboxOperation = { ...op, status: 'syncing' };
      await db.outbox.put(updated);
      claimed.push(updated);
    }
    return claimed;
  });
}

export async function markOperationSynced(operationId: string): Promise<void> {
  await getDB().outbox.delete(operationId);
}

/**
 * Devuelve la operación a `pending` tras un fallo transitorio (red),
 * o la deja en `failed` si es permanente (validación del servidor).
 */
export async function markOperationFailed(
  operationId: string,
  error: string,
  permanent: boolean,
): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.outbox, async () => {
    const op = await db.outbox.get(operationId);
    if (!op) return;
    await db.outbox.put({
      ...op,
      status: permanent ? 'failed' : 'pending',
      attempts: op.attempts + 1,
      lastError: error.slice(0, 500),
    });
  });
}

/** Operaciones que quedaron en `syncing` tras un crash: volver a pending. */
export async function releaseStaleSyncing(): Promise<void> {
  const db = getDB();
  const stale = await db.outbox.where('status').equals('syncing').toArray();
  for (const op of stale) {
    await db.outbox.put({ ...op, status: 'pending' });
  }
}

export async function countPending(): Promise<number> {
  const db = getDB();
  return db.outbox.where('status').anyOf(['pending', 'failed']).count();
}
