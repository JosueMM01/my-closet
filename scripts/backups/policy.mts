import { z } from 'zod';

export const BACKUP_APP_ID = 'my-closet-database-backup';
export const DEFAULT_MINIMUM_AGE_DAYS = 8;
export const DEFAULT_RETENTION_COUNT = 2;

const isoDateSchema = z.iso.datetime({ offset: true });
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const driveBackupFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdTime: isoDateSchema,
  size: z.string().regex(/^\d+$/).optional(),
  md5Checksum: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  appProperties: z.record(z.string(), z.string()).optional(),
});

export type DriveBackupFile = z.infer<typeof driveBackupFileSchema>;

export const backupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  createdAt: isoDateSchema,
  source: z.object({
    databaseName: z.string().min(1),
    postgresServerVersion: z.string().min(1),
    pgDumpVersion: z.string().min(1),
  }),
  dump: z.object({
    fileName: z.string().min(1),
    driveFileId: z.string().min(1),
    plainBytes: z.number().int().nonnegative(),
    plainSha256: checksumSchema,
    encryptedBytes: z.number().int().positive(),
    encryptedSha256: checksumSchema,
  }),
  restore: z.discriminatedUnion('status', [
    z.object({ status: z.literal('pending') }),
    z.object({
      status: z.literal('verified'),
      verifiedAt: isoDateSchema,
      postgresServerVersion: z.string().min(1),
    }),
  ]),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

function isCompleteManifest(file: DriveBackupFile): boolean {
  return file.appProperties?.app === BACKUP_APP_ID
    && file.appProperties.kind === 'manifest'
    && file.appProperties.status === 'complete'
    && Boolean(file.appProperties.runId);
}

export function completedManifests(files: readonly DriveBackupFile[]): DriveBackupFile[] {
  return files
    .filter(isCompleteManifest)
    .toSorted((left, right) => Date.parse(right.createdTime) - Date.parse(left.createdTime));
}

export function isBackupDue(input: {
  files: readonly DriveBackupFile[];
  now: Date;
  minimumAgeDays?: number;
  force?: boolean;
}): { due: boolean; lastBackupAt: string | null } {
  const manifests = completedManifests(input.files);
  const lastBackupAt = manifests[0]?.createdTime ?? null;

  if (input.force || !lastBackupAt) {
    return { due: true, lastBackupAt };
  }

  const minimumAgeDays = input.minimumAgeDays ?? DEFAULT_MINIMUM_AGE_DAYS;
  if (!Number.isInteger(minimumAgeDays) || minimumAgeDays < 1) {
    throw new Error('minimumAgeDays debe ser un entero positivo');
  }

  const elapsed = input.now.getTime() - Date.parse(lastBackupAt);
  return {
    due: elapsed >= minimumAgeDays * 24 * 60 * 60 * 1000,
    lastBackupAt,
  };
}

export function expiredBackupRunIds(
  files: readonly DriveBackupFile[],
  retentionCount = DEFAULT_RETENTION_COUNT,
): string[] {
  if (!Number.isInteger(retentionCount) || retentionCount < 2) {
    throw new Error('retentionCount debe conservar al menos dos respaldos');
  }

  const retained = completedManifests(files);
  return retained
    .slice(retentionCount)
    .map((file) => file.appProperties?.runId)
    .filter((runId): runId is string => Boolean(runId));
}

export function filesForRun(
  files: readonly DriveBackupFile[],
  runId: string,
): DriveBackupFile[] {
  return files.filter((file) => file.appProperties?.app === BACKUP_APP_ID
    && file.appProperties.runId === runId);
}

export function validateDirectPostgresSource(input: {
  connectionUrl: string;
  expectedHost: string;
  expectedDatabase: string;
}): { host: string; database: string } {
  let parsed: URL;
  try {
    parsed = new URL(input.connectionUrl);
  } catch {
    throw new Error('NEON_DATABASE_URL_UNPOOLED no es una URL válida');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('La conexión de respaldo debe usar PostgreSQL');
  }
  if (parsed.hostname.includes('-pooler')) {
    throw new Error('pg_dump requiere el endpoint directo de Neon, no el pooler');
  }
  if (parsed.hostname !== input.expectedHost) {
    throw new Error('La URL de respaldo no corresponde al endpoint de producción esperado');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database || database !== input.expectedDatabase) {
    throw new Error('La URL de respaldo no corresponde a la base de producción esperada');
  }
  const sslMode = parsed.searchParams.get('sslmode');
  if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('La conexión directa de Neon debe exigir TLS mediante sslmode');
  }

  return { host: parsed.hostname, database };
}
