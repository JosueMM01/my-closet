import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP_ID,
  completedManifests,
  expiredBackupRunIds,
  filesForRun,
  isBackupDue,
  staleIncompleteFiles,
  validateDirectPostgresSource,
  validateTemporaryRestoreTarget,
  validatePostgresToolVersion,
  type DriveBackupFile,
} from '../../scripts/backups/policy.mts';

describe('compatibilidad de herramientas PostgreSQL', () => {
  it('rechaza pg_dump 17 contra un servidor 18 antes de crear la copia', () => {
    expect(() => validatePostgresToolVersion('18.3 (Neon)', 'pg_dump (PostgreSQL) 17.9'))
      .toThrow(/pg_dump 17 no puede respaldar PostgreSQL 18/);
  });

  it('admite herramientas del mismo major o uno posterior', () => {
    expect(() => validatePostgresToolVersion('18.3\n', 'pg_dump (PostgreSQL) 18.3\n')).not.toThrow();
    expect(() => validatePostgresToolVersion('17.9', 'pg_dump (PostgreSQL) 18.3')).not.toThrow();
  });

  it('no acepta versiones ausentes o no identificables', () => {
    expect(() => validatePostgresToolVersion('', 'pg_dump (PostgreSQL) 18.3')).toThrow(/identificar/);
    expect(() => validatePostgresToolVersion('18.3', 'unknown')).toThrow(/identificar/);
  });
});

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
    size: '100',
    appProperties: {
      app: BACKUP_APP_ID,
      kind: input.kind ?? 'manifest',
      status: input.status ?? 'complete',
      runId: input.runId,
    },
  };
}

function withArchives(files: DriveBackupFile[]): DriveBackupFile[] {
  return files.flatMap((entry) => entry.appProperties?.kind === 'manifest' ? [entry, {
    ...entry,
    id: `archive-${entry.id}`,
    appProperties: { ...entry.appProperties, kind: 'archive' },
  }] : [entry]);
}

describe('política de respaldos externos', () => {
  it('crea el primer respaldo y respeta ocho días desde el último éxito', () => {
    expect(isBackupDue({ files: [], now: new Date('2026-08-30T06:00:00Z') }))
      .toEqual({ due: true, lastBackupAt: null });

    const files = withArchives([file({
      id: 'manifest-1',
      runId: 'run-1',
      createdTime: '2026-08-23T06:00:00Z',
    })]);

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
      files: withArchives([file({ id: 'complete', runId: 'run', createdTime: '2026-08-30T05:59:00Z' })]),
      now: new Date('2026-08-30T06:00:00Z'),
      force: true,
    }).due).toBe(true);
  });

  it('retiene los dos respaldos completos más recientes y rota por pareja', () => {
    const files = withArchives([
      file({ id: 'manifest-1', runId: 'run-1', createdTime: '2026-08-01T06:00:00Z' }),
      file({ id: 'manifest-2', runId: 'run-2', createdTime: '2026-08-09T06:00:00Z' }),
      file({ id: 'manifest-3', runId: 'run-3', createdTime: '2026-08-17T06:00:00Z' }),
    ]);

    expect(expiredBackupRunIds(files)).toEqual(['run-1']);
    expect(filesForRun(files, 'run-1').map((entry) => entry.id))
      .toEqual(['manifest-1', 'archive-manifest-1']);
  });

  it('nunca admite una retención menor a dos copias', () => {
    expect(() => expiredBackupRunIds([], 1)).toThrow(/dos respaldos/);
  });

  it('un manifiesto sin archivo completo no pospone el respaldo ni ocupa retención', () => {
    const recent = file({ id: 'orphan', runId: 'orphan', createdTime: '2026-08-30T05:59:00Z' });
    expect(completedManifests([recent])).toEqual([]);
    expect(isBackupDue({ files: [recent], now: new Date('2026-08-30T06:00:00Z') }).due).toBe(true);
    const archive: DriveBackupFile = { ...recent, id: 'empty', size: '0', appProperties: {
      ...recent.appProperties, kind: 'archive',
    } };
    expect(completedManifests([recent, archive])).toEqual([]);
    archive.size = '100';
    archive.appProperties = { ...archive.appProperties, status: 'uploading' };
    expect(completedManifests([recent, archive])).toEqual([]);
  });

  it('ignora archivos de otra app y cuenta una sola vez los manifiestos duplicados', () => {
    const files = withArchives([file({ id: 'm', runId: 'run', createdTime: '2026-08-30T06:00:00Z' })]);
    expect(completedManifests([...files, { ...files[0]!, id: 'duplicate' }])).toHaveLength(1);
    const archive = files[1]!;
    expect(completedManifests([files[0]!, { ...archive,
      appProperties: { ...archive.appProperties, app: 'another-app' },
    }])).toEqual([]);
  });

  it('un manifiesto huérfano reciente no hace eliminar una de las dos copias válidas', () => {
    const files = withArchives([
      file({ id: 'old', runId: 'old', createdTime: '2026-08-01T06:00:00Z' }),
      file({ id: 'new', runId: 'new', createdTime: '2026-08-09T06:00:00Z' }),
    ]);
    files.push(file({ id: 'broken', runId: 'broken', createdTime: '2026-08-17T06:00:00Z' }));
    expect(expiredBackupRunIds(files)).toEqual([]);
  });

  it('solo limpia incompletos de respaldo antiguos cuando hay dos generaciones válidas', () => {
    const now = new Date('2026-08-30T06:00:00Z');
    const stale = file({ id: 'stale', runId: 'failed', status: 'uploading', createdTime: '2026-08-01T06:00:00Z' });
    expect(staleIncompleteFiles([stale], now)).toEqual([]);
    const files = withArchives([
      file({ id: 'one', runId: 'one', createdTime: '2026-08-23T06:00:00Z' }),
      file({ id: 'two', runId: 'two', createdTime: '2026-08-24T06:00:00Z' }),
    ]);
    expect(staleIncompleteFiles([...files, stale], now)).toEqual([stale]);
    expect(staleIncompleteFiles([...files, { ...stale, createdTime: now.toISOString() }], now)).toEqual([]);
    expect(staleIncompleteFiles([...files, { ...stale,
      appProperties: { ...stale.appProperties, kind: 'folder' },
    }], now)).toEqual([]);
    expect(staleIncompleteFiles([...files, { ...stale,
      appProperties: { ...stale.appProperties, app: 'another-app' },
    }], now)).toEqual([]);
  });

  it('rechaza restauraciones sobre producción, pooler y ramas reutilizadas', () => {
    const input = {
      connectionUrl: 'postgresql://owner:fixture@ep-temporary.us-east-2.aws.neon.tech/neondb?sslmode=require',
      productionHost: 'ep-production.us-east-2.aws.neon.tech',
      expectedTemporaryHost: 'ep-temporary.us-east-2.aws.neon.tech',
      branchId: 'br-temporary-test',
      branchCreated: true,
      expectedDatabase: 'neondb',
    };
    expect(() => validateTemporaryRestoreTarget(input)).not.toThrow();
    expect(() => validateTemporaryRestoreTarget({ ...input, branchCreated: false })).toThrow(/recién creada/);
    expect(() => validateTemporaryRestoreTarget({ ...input, branchId: '' })).toThrow(/recién creada/);
    expect(() => validateTemporaryRestoreTarget({ ...input,
      expectedTemporaryHost: input.productionHost,
    })).toThrow(/distinto de producción/);
    expect(() => validateTemporaryRestoreTarget({ ...input,
      connectionUrl: 'postgresql://owner:fixture@ep-production.us-east-2.aws.neon.tech/neondb?sslmode=require',
    })).toThrow(/endpoint/);
    expect(() => validateTemporaryRestoreTarget({ ...input,
      expectedTemporaryHost: 'ep-temporary-pooler.us-east-2.aws.neon.tech',
      connectionUrl: 'postgresql://owner:fixture@ep-temporary-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
    })).toThrow(/pooler/);
    expect(() => validateTemporaryRestoreTarget({ ...input, productionHost: '' })).toThrow(/producción/);
    expect(() => validateTemporaryRestoreTarget({ ...input,
      connectionUrl: input.connectionUrl.replace('sslmode=require', 'sslmode=disable'),
    })).toThrow(/TLS/);
    expect(() => validateTemporaryRestoreTarget({ ...input, expectedDatabase: 'another-db' })).toThrow(/base/);
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
