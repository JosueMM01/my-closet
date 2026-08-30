import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP_ID,
  expiredBackupRunIds,
  filesForRun,
  isBackupDue,
  validateDirectPostgresSource,
  type DriveBackupFile,
} from '../../scripts/backups/policy.mts';

function file(input: {
  id: string;
  createdTime: string;
  runId: string;
  kind?: 'archive' | 'manifest';
  status?: 'complete' | 'uploading';
}): DriveBackupFile {
  return {
    id: input.id,
    name: `${input.id}.json`,
    createdTime: input.createdTime,
    appProperties: {
      app: BACKUP_APP_ID,
      kind: input.kind ?? 'manifest',
      status: input.status ?? 'complete',
      runId: input.runId,
    },
  };
}

describe('política de respaldos externos', () => {
  it('crea el primer respaldo y respeta ocho días desde el último éxito', () => {
    expect(isBackupDue({ files: [], now: new Date('2026-08-30T06:00:00Z') }))
      .toEqual({ due: true, lastBackupAt: null });

    const files = [file({
      id: 'manifest-1',
      runId: 'run-1',
      createdTime: '2026-08-23T06:00:00Z',
    })];

    expect(isBackupDue({ files, now: new Date('2026-08-30T06:00:00Z') }).due).toBe(false);
    expect(isBackupDue({ files, now: new Date('2026-08-31T06:00:00Z') }).due).toBe(true);
  });

  it('ignora cargas incompletas y permite forzar una ejecución manual', () => {
    const files = [file({
      id: 'temporary',
      runId: 'failed-run',
      createdTime: '2026-08-30T05:59:00Z',
      status: 'uploading',
    })];

    expect(isBackupDue({ files, now: new Date('2026-08-30T06:00:00Z') }).due).toBe(true);
    expect(isBackupDue({
      files: [file({ id: 'complete', runId: 'run', createdTime: '2026-08-30T05:59:00Z' })],
      now: new Date('2026-08-30T06:00:00Z'),
      force: true,
    }).due).toBe(true);
  });

  it('retiene los dos respaldos completos más recientes y rota por pareja', () => {
    const files = [
      file({ id: 'manifest-1', runId: 'run-1', createdTime: '2026-08-01T06:00:00Z' }),
      file({ id: 'archive-1', runId: 'run-1', kind: 'archive', createdTime: '2026-08-01T06:00:01Z' }),
      file({ id: 'manifest-2', runId: 'run-2', createdTime: '2026-08-09T06:00:00Z' }),
      file({ id: 'manifest-3', runId: 'run-3', createdTime: '2026-08-17T06:00:00Z' }),
    ];

    expect(expiredBackupRunIds(files)).toEqual(['run-1']);
    expect(filesForRun(files, 'run-1').map((entry) => entry.id))
      .toEqual(['manifest-1', 'archive-1']);
  });

  it('nunca admite una retención menor a dos copias', () => {
    expect(() => expiredBackupRunIds([], 1)).toThrow(/dos respaldos/);
  });

  it('valida el endpoint directo y la base exacta de producción', () => {
    expect(validateDirectPostgresSource({
      connectionUrl: 'postgresql://owner:secret@ep-production.us-east-2.aws.neon.tech/neondb?sslmode=require',
      expectedHost: 'ep-production.us-east-2.aws.neon.tech',
      expectedDatabase: 'neondb',
    })).toEqual({
      host: 'ep-production.us-east-2.aws.neon.tech',
      database: 'neondb',
    });

    expect(() => validateDirectPostgresSource({
      connectionUrl: 'postgresql://owner:secret@ep-staging.us-east-2.aws.neon.tech/neondb?sslmode=require',
      expectedHost: 'ep-production.us-east-2.aws.neon.tech',
      expectedDatabase: 'neondb',
    })).toThrow(/producción esperado/);

    expect(() => validateDirectPostgresSource({
      connectionUrl: 'postgresql://owner:secret@ep-production-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
      expectedHost: 'ep-production-pooler.us-east-2.aws.neon.tech',
      expectedDatabase: 'neondb',
    })).toThrow(/no el pooler/);
  });
});
