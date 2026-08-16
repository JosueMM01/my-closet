/**
 * Resolución de conflictos offline-first (sin CRDT).
 *
 * Modelo: last-writer-wins con (version, updatedAt) y desempate determinista.
 * Reglas:
 *  1. Mayor `version` gana (cada dispositivo incrementa al escribir).
 *  2. Empate de versión → mayor `updatedAt` gana.
 *  3. Empate total → mayor `id` lexicográfico gana (evita ping-pong).
 *  4. Un tombstone (deletedAt) se trata como cualquier escritura:
 *     si la eliminación es la escritura más reciente, gana.
 */
import type { SyncEntity } from './types';

export type ConflictWinner = 'local' | 'remote';

export function resolveConflict(
  local: Pick<SyncEntity, 'id' | 'version' | 'updatedAt' | 'deletedAt'>,
  remote: Pick<SyncEntity, 'id' | 'version' | 'updatedAt' | 'deletedAt'>,
): ConflictWinner {
  if (remote.version !== local.version) {
    return remote.version > local.version ? 'remote' : 'local';
  }
  const localTs = Date.parse(local.updatedAt);
  const remoteTs = Date.parse(remote.updatedAt);
  if (remoteTs !== localTs) {
    return remoteTs > localTs ? 'remote' : 'local';
  }
  return remote.id > local.id ? 'remote' : 'local';
}

/**
 * Decide si conviene reemplazar la copia local con la remota.
 * Devuelve true solo si la remota gana el conflicto.
 */
export function shouldApplyRemote(
  local: Pick<SyncEntity, 'id' | 'version' | 'updatedAt' | 'deletedAt'> | undefined,
  remote: Pick<SyncEntity, 'id' | 'version' | 'updatedAt' | 'deletedAt'>,
): boolean {
  if (!local) return true;
  return resolveConflict(local, remote) === 'remote';
}

/** Incrementa versión y refresca updatedAt para una nueva escritura local. */
export function nextWrite(
  entity: Pick<SyncEntity, 'version' | 'updatedAt'>,
): { version: number; updatedAt: string } {
  return {
    version: entity.version + 1,
    updatedAt: new Date().toISOString(),
  };
}
