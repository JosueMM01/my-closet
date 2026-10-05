import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  BACKUP_APP_ID,
  DEFAULT_MINIMUM_AGE_DAYS,
  DEFAULT_RETENTION_COUNT,
  backupManifestSchema,
  completedManifests,
  driveBackupFileSchema,
  expiredBackupRunIds,
  filesForRun,
  isBackupDue,
  staleIncompleteFiles,
  validateDirectPostgresSource,
  validateTemporaryRestoreTarget,
  validatePostgresToolVersion,
  type BackupManifest,
  type DriveBackupFile,
} from './policy.mts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

const oauthEnvironmentSchema = z.object({
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_DRIVE_REFRESH_TOKEN: z.string().min(1),
});

const backupEnvironmentSchema = oauthEnvironmentSchema.extend({
  GOOGLE_DRIVE_BACKUP_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

const sourceEnvironmentSchema = z.object({
  DATABASE_URL_UNPOOLED: z.string().min(1),
  EXPECTED_NEON_PRODUCTION_HOST: z.string().min(1),
  BACKUP_DATABASE_NAME: z.string().min(1),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().min(1),
});

const oauthErrorSchema = z.object({
  error: z.enum(['invalid_grant', 'invalid_client', 'invalid_scope']),
});

const driveFileListSchema = z.object({
  nextPageToken: z.string().optional(),
  files: z.array(driveBackupFileSchema),
});

const uploadResultSchema = driveBackupFileSchema.extend({
  size: z.string().regex(/^\d+$/),
  md5Checksum: z.string().regex(/^[a-f0-9]{32}$/),
});

function environment<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuración de respaldo incompleta o inválida: ${names}`);
  }
  return result.data;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
}

function booleanValue(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

async function githubOutput(name: string, value: string | number | boolean): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    await appendFile(outputPath, `${name}=${String(value)}\n`, 'utf8');
  }
}

async function githubSummary(message: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, `${message}\n`, 'utf8');
  }
}

async function getAccessToken(): Promise<string> {
  const env = environment(oauthEnvironmentSchema);
  const body = new URLSearchParams({
    client_id: env.GOOGLE_DRIVE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    // Only allowlisted error codes are usable. Never log Google's response body,
    // error_description, tokens or client credentials, even on malformed responses.
    const result = oauthErrorSchema.safeParse(await response.json().catch(() => null));
    const reason = result.success ? result.data.error : undefined;
    const guidance = reason === 'invalid_grant'
      ? 'invalid_grant: autorización vencida o revocada; reautoriza Drive con el cliente de respaldos y reemplaza GOOGLE_DRIVE_REFRESH_TOKEN. Las copias existentes no se modificaron.'
      : reason === 'invalid_client'
        ? 'invalid_client: revisa el ID y secreto del cliente OAuth de respaldos; no uses el cliente de Google Sign-In.'
        : reason === 'invalid_scope'
          ? 'invalid_scope: revisa los permisos de Drive y vuelve a autorizar el cliente de respaldos.'
          : 'Revisa el estado de Google OAuth; no se realizaron operaciones en Drive.';
    throw new Error(`Google OAuth rechazó la renovación del token (${response.status}). ${guidance}`);
  }
  return tokenResponseSchema.parse(await response.json()).access_token;
}

async function driveFetch(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Google Drive respondió ${response.status} en una operación de respaldo`);
  }
  return response;
}

async function listDriveChildren(token: string, folderId: string): Promise<DriveBackupFile[]> {
  const files: DriveBackupFile[] = [];
  let pageToken: string | undefined;

  do {
    const query = `'${folderId}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q: query,
      spaces: 'drive',
      pageSize: '1000',
      orderBy: 'createdTime desc',
      fields: 'nextPageToken,files(id,name,size,md5Checksum,createdTime,appProperties,mimeType,parents)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch(token, `${DRIVE_API}/files?${params}`);
    const page = driveFileListSchema.parse(await response.json());
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

function isGenerationFolder(file: DriveBackupFile): boolean {
  return file.mimeType === DRIVE_FOLDER_MIME && file.appProperties?.app === BACKUP_APP_ID
    && file.appProperties.kind === 'generation' && Boolean(file.appProperties.runId);
}

/** Compatible con copias históricas planas; no recorre carpetas ajenas ni recursivamente. */
async function listDriveFiles(token: string, folderId: string): Promise<DriveBackupFile[]> {
  const roots = (await listDriveChildren(token, folderId))
    .filter(file => file.appProperties?.app === BACKUP_APP_ID);
  const files = [...roots];
  for (const folder of roots.filter(isGenerationFolder)) {
    const children = await listDriveChildren(token, folder.id);
    files.push(...children.filter(file => file.mimeType !== DRIVE_FOLDER_MIME
      && file.appProperties?.app === BACKUP_APP_ID
      && file.appProperties.runId === folder.appProperties?.runId));
  }
  return files;
}

async function createGenerationFolder(token: string, parentId: string, runId: string, createdAt: string): Promise<string> {
  const response = await driveFetch(token, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      name: `respaldo-${createdAt.replaceAll(':', '-')}`,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
      appProperties: { app: BACKUP_APP_ID, kind: 'generation', runId, status: 'uploading' },
    }),
  });
  return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
}

async function hashFile(filePath: string, algorithm: 'md5' | 'sha256'): Promise<string> {
  const data = await readFile(filePath);
  return createHash(algorithm).update(data).digest('hex');
}

async function uploadResumable(input: {
  token: string;
  filePath: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  fileId?: string;
}): Promise<z.infer<typeof uploadResultSchema>> {
  const fileStats = await stat(input.filePath);
  const contents = await readFile(input.filePath);
  const endpoint = input.fileId
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(input.fileId)}`
    : `${DRIVE_UPLOAD_API}/files`;
  const params = new URLSearchParams({
    uploadType: 'resumable',
    fields: 'id,name,size,md5Checksum,createdTime,appProperties',
  });
  const start = await driveFetch(input.token, `${endpoint}?${params}`, {
    method: input.fileId ? 'PATCH' : 'POST',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': input.mimeType,
      'x-upload-content-length': String(fileStats.size),
    },
    body: JSON.stringify(input.metadata),
  });
  const location = start.headers.get('location');
  if (!location) throw new Error('Google Drive no devolvió una sesión de carga reanudable');

  const upload = await driveFetch(input.token, location, {
    method: 'PUT',
    headers: {
      'content-type': input.mimeType,
      'content-length': String(fileStats.size),
    },
    body: contents,
  });
  const result = uploadResultSchema.parse(await upload.json());
  if (Number(result.size) !== fileStats.size
      || result.md5Checksum !== createHash('md5').update(contents).digest('hex')) {
    throw new Error('El archivo subido a Drive no coincide en tamaño o MD5');
  }
  return result;
}

async function patchDriveMetadata(
  token: string,
  fileId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadata),
  });
}

async function downloadDriveFile(token: string, fileId: string, outputPath: string): Promise<void> {
  const response = await driveFetch(
    token,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
}

async function maintainRetention(input: {
  token: string;
  folderId: string;
  retentionCount: number;
}): Promise<number> {
  const allFiles = await listDriveFiles(input.token, input.folderId);
  const expiredRuns = expiredBackupRunIds(allFiles, input.retentionCount);
  let deletedFiles = 0;
  for (const expiredRunId of expiredRuns) {
    const runFiles = filesForRun(allFiles, expiredRunId).filter(file => !isGenerationFolder(file))
      .toSorted((left, right) => {
        const leftOrder = left.appProperties?.kind === 'manifest' ? 0 : 1;
        const rightOrder = right.appProperties?.kind === 'manifest' ? 0 : 1;
        return leftOrder - rightOrder;
      });
    for (const file of runFiles) {
      await deleteDriveFile(input.token, file.id);
      deletedFiles += 1;
    }
  }

  for (const file of staleIncompleteFiles(allFiles, new Date(), input.retentionCount)) {
    if (isGenerationFolder(file)) continue; // Nunca borrar una carpeta con contenido desconocido.
    await deleteDriveFile(input.token, file.id);
    deletedFiles += 1;
  }
  // Primero archivos propios; la carpeta solo se elimina si está realmente vacía.
  // Ante fallo parcial, el próximo mantenimiento vuelve a intentar de forma segura.
  for (const folder of allFiles.filter(isGenerationFolder)) {
    if ((await listDriveChildren(input.token, folder.id)).length === 0) {
      await deleteDriveFile(input.token, folder.id);
      deletedFiles += 1;
    }
  }
  return deletedFiles;
}

async function initFolder(): Promise<void> {
  const token = await getAccessToken();
  const response = await driveFetch(token, `${DRIVE_API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      name: 'My Closet Backups',
      mimeType: DRIVE_FOLDER_MIME,
      appProperties: { app: BACKUP_APP_ID, kind: 'folder' },
    }),
  });
  const folder = z.object({ id: z.string().min(1), name: z.string().min(1) })
    .parse(await response.json());
  console.log(`Carpeta privada creada: ${folder.name}`);
  console.log(`GOOGLE_DRIVE_BACKUP_FOLDER_ID=${folder.id}`);
}

async function validateSource(): Promise<void> {
  const env = environment(sourceEnvironmentSchema);
  const source = validateDirectPostgresSource({
    connectionUrl: env.DATABASE_URL_UNPOOLED,
    expectedHost: env.EXPECTED_NEON_PRODUCTION_HOST,
    expectedDatabase: env.BACKUP_DATABASE_NAME,
  });
  await githubSummary(`- Fuente Neon validada: endpoint directo y base ${source.database}.`);
  console.log('La fuente del respaldo coincide con el endpoint directo de producción.');
}

async function validateToolVersion(): Promise<void> {
  const [serverVersion, toolVersion] = await Promise.all([
    readFile(requiredPath('BACKUP_SERVER_VERSION_PATH'), 'utf8'),
    readFile(requiredPath('BACKUP_PG_DUMP_VERSION_PATH'), 'utf8'),
  ]);
  validatePostgresToolVersion(serverVersion, toolVersion);
  console.log('pg_dump es compatible con la versión de PostgreSQL del origen.');
}

async function status(): Promise<void> {
  const env = environment(backupEnvironmentSchema);
  const token = await getAccessToken();
  const files = await listDriveFiles(token, env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
  const minimumAgeDays = positiveInteger(
    process.env.BACKUP_MINIMUM_AGE_DAYS,
    DEFAULT_MINIMUM_AGE_DAYS,
    'BACKUP_MINIMUM_AGE_DAYS',
  );
  const result = isBackupDue({
    files,
    now: new Date(),
    minimumAgeDays,
    force: booleanValue(process.env.FORCE_BACKUP),
  });
  await githubOutput('due', result.due);
  await githubOutput('last_backup_at', result.lastBackupAt ?? 'none');
  await githubSummary(
    result.due
      ? `- Respaldo requerido. Último respaldo: ${result.lastBackupAt ?? 'ninguno'}.`
      : `- Respaldo todavía vigente. Último respaldo: ${result.lastBackupAt}.`,
  );
  console.log(result.due ? 'Se debe crear un respaldo.' : 'Todavía no corresponde crear otro respaldo.');
}

async function validateRestore(): Promise<void> {
  const env = environment(z.object({
    RESTORE_DATABASE_URL: z.string().min(1),
    EXPECTED_NEON_PRODUCTION_HOST: z.string().min(1),
    EXPECTED_NEON_TEMPORARY_HOST: z.string().min(1),
    RESTORE_BRANCH_ID: z.string().min(1),
    RESTORE_BRANCH_CREATED: z.enum(['true', 'false']),
    BACKUP_DATABASE_NAME: z.string().min(1),
  }));
  validateTemporaryRestoreTarget({
    connectionUrl: env.RESTORE_DATABASE_URL,
    productionHost: env.EXPECTED_NEON_PRODUCTION_HOST,
    expectedTemporaryHost: env.EXPECTED_NEON_TEMPORARY_HOST,
    branchId: env.RESTORE_BRANCH_ID,
    branchCreated: env.RESTORE_BRANCH_CREATED === 'true',
    expectedDatabase: env.BACKUP_DATABASE_NAME,
  });
  console.log('Destino de restauración validado: rama nueva y endpoint ajeno a producción.');
}

function requiredPath(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return path.resolve(value);
}

async function uploadBackup(): Promise<void> {
  const env = environment(backupEnvironmentSchema);
  const token = await getAccessToken();
  const dumpPath = requiredPath('BACKUP_DUMP_PATH');
  const archivePath = requiredPath('BACKUP_ARCHIVE_PATH');
  const serverVersionPath = requiredPath('BACKUP_SERVER_VERSION_PATH');
  const pgDumpVersionPath = requiredPath('BACKUP_PG_DUMP_VERSION_PATH');
  const databaseName = z.string().min(1).parse(process.env.BACKUP_DATABASE_NAME);
  const [dumpStats, archiveStats, plainSha256, encryptedSha256, encryptedMd5] = await Promise.all([
    stat(dumpPath),
    stat(archivePath),
    hashFile(dumpPath, 'sha256'),
    hashFile(archivePath, 'sha256'),
    hashFile(archivePath, 'md5'),
  ]);
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replaceAll(/[-:.]/g, '').replace('Z', 'Z');
  const runId = `${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${randomUUID()}`;
  const archiveName = `my-closet-${timestamp}.dump.age`;
  const manifestName = `my-closet-${timestamp}.manifest.json`;
  const commonProperties = { app: BACKUP_APP_ID, runId };
  const generationFolderId = await createGenerationFolder(token, env.GOOGLE_DRIVE_BACKUP_FOLDER_ID, runId, createdAt);

  const uploadedArchive = await uploadResumable({
    token,
    filePath: archivePath,
    mimeType: 'application/octet-stream',
    metadata: {
      name: `${archiveName}.uploading`,
      parents: [generationFolderId],
      appProperties: {
        ...commonProperties,
        kind: 'archive',
        status: 'uploading',
      },
    },
  });
  if (Number(uploadedArchive.size) !== archiveStats.size
      || uploadedArchive.md5Checksum !== encryptedMd5) {
    throw new Error('La copia subida a Drive no coincide en tamaño o MD5');
  }

  await patchDriveMetadata(token, uploadedArchive.id, {
    name: archiveName,
    appProperties: {
      ...commonProperties,
      kind: 'archive',
      status: 'complete',
    },
  });

  const manifest: BackupManifest = backupManifestSchema.parse({
    schemaVersion: 1,
    runId,
    createdAt,
    source: {
      databaseName,
      postgresServerVersion: (await readFile(serverVersionPath, 'utf8')).trim(),
      pgDumpVersion: (await readFile(pgDumpVersionPath, 'utf8')).trim(),
    },
    dump: {
      fileName: archiveName,
      driveFileId: uploadedArchive.id,
      plainBytes: dumpStats.size,
      plainSha256,
      encryptedBytes: archiveStats.size,
      encryptedSha256,
    },
    restore: { status: 'pending' },
  });
  const manifestPath = path.join(path.dirname(archivePath), manifestName);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const uploadedManifest = await uploadResumable({
    token,
    filePath: manifestPath,
    mimeType: 'application/json',
    metadata: {
      name: manifestName,
      parents: [generationFolderId],
      appProperties: {
        ...commonProperties,
        kind: 'manifest',
        status: 'uploading',
        restoreStatus: 'pending',
      },
    },
  });
  await patchDriveMetadata(token, uploadedManifest.id, {
    appProperties: {
      ...commonProperties,
      kind: 'manifest',
      status: 'complete',
      restoreStatus: 'pending',
    },
  });

  await patchDriveMetadata(token, generationFolderId, {
    appProperties: { ...commonProperties, kind: 'generation', status: 'complete' },
  });

  const retentionCount = positiveInteger(
    process.env.BACKUP_RETENTION_COUNT,
    DEFAULT_RETENTION_COUNT,
    'BACKUP_RETENTION_COUNT',
  );
  const deletedFiles = await maintainRetention({
    token,
    folderId: env.GOOGLE_DRIVE_BACKUP_FOLDER_ID,
    retentionCount,
  });

  await githubOutput('created', true);
  await githubOutput('run_id', runId);
  await githubOutput('archive_name', archiveName);
  await githubSummary(`- Respaldo cifrado verificado y subido: ${archiveName}.`);
  await githubSummary(`- Rotación completada; archivos antiguos o incompletos retirados: ${deletedFiles}.`);
  console.log(`Respaldo cifrado subido y verificado: ${archiveName}`);
}

async function maintain(): Promise<void> {
  const env = environment(backupEnvironmentSchema);
  const token = await getAccessToken();
  const retentionCount = positiveInteger(
    process.env.BACKUP_RETENTION_COUNT,
    DEFAULT_RETENTION_COUNT,
    'BACKUP_RETENTION_COUNT',
  );
  const deletedFiles = await maintainRetention({
    token,
    folderId: env.GOOGLE_DRIVE_BACKUP_FOLDER_ID,
    retentionCount,
  });
  await githubSummary(`- Mantenimiento de retención: ${deletedFiles} archivos retirados.`);
  console.log(`Mantenimiento de retención completado: ${deletedFiles} archivos retirados.`);
}

async function downloadLatest(): Promise<void> {
  const env = environment(backupEnvironmentSchema);
  const token = await getAccessToken();
  const files = await listDriveFiles(token, env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
  const manifestFile = completedManifests(files)[0];
  if (!manifestFile) throw new Error('No existe un respaldo completo en Google Drive');
  const manifestPath = requiredPath('BACKUP_MANIFEST_PATH');
  const archivePath = requiredPath('BACKUP_ARCHIVE_PATH');
  await downloadDriveFile(token, manifestFile.id, manifestPath);
  const manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.runId !== manifestFile.appProperties?.runId) {
    throw new Error('El manifiesto no corresponde al identificador de la copia en Drive');
  }
  const archiveFile = files.find((file) => file.id === manifest.dump.driveFileId
    && file.appProperties?.runId === manifest.runId
    && file.appProperties.kind === 'archive'
    && file.appProperties.status === 'complete');
  if (!archiveFile) throw new Error('El manifiesto apunta a un archivo incompleto o inexistente');
  await downloadDriveFile(token, archiveFile.id, archivePath);
  const archiveStats = await stat(archivePath);
  const encryptedSha256 = await hashFile(archivePath, 'sha256');
  if (archiveStats.size !== manifest.dump.encryptedBytes
      || encryptedSha256 !== manifest.dump.encryptedSha256) {
    throw new Error('El respaldo descargado no coincide con su manifiesto SHA-256');
  }
  await githubOutput('run_id', manifest.runId);
  await githubOutput('archive_name', manifest.dump.fileName);
  await githubSummary(`- Respaldo descargado y SHA-256 verificado: ${manifest.dump.fileName}.`);
  console.log(`Respaldo descargado y verificado: ${manifest.dump.fileName}`);
}

async function verifyPlainDump(): Promise<void> {
  const manifestPath = requiredPath('BACKUP_MANIFEST_PATH');
  const dumpPath = requiredPath('BACKUP_DUMP_PATH');
  const manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const dumpStats = await stat(dumpPath);
  const plainSha256 = await hashFile(dumpPath, 'sha256');
  if (dumpStats.size !== manifest.dump.plainBytes || plainSha256 !== manifest.dump.plainSha256) {
    throw new Error('El dump descifrado no coincide con su manifiesto SHA-256');
  }
  console.log('Dump descifrado y verificado correctamente.');
}

async function markRestored(): Promise<void> {
  const env = environment(backupEnvironmentSchema);
  const token = await getAccessToken();
  const manifestPath = requiredPath('BACKUP_MANIFEST_PATH');
  const restoredVersionPath = requiredPath('RESTORED_SERVER_VERSION_PATH');
  const manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const files = await listDriveFiles(token, env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
  const manifestFile = files.find((file) => file.appProperties?.runId === manifest.runId
    && file.appProperties.kind === 'manifest'
    && file.appProperties.status === 'complete');
  if (!manifestFile) throw new Error('No se encontró el manifiesto que se debe marcar como restaurado');
  const verifiedManifest = backupManifestSchema.parse({
    ...manifest,
    restore: {
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      postgresServerVersion: (await readFile(restoredVersionPath, 'utf8')).trim(),
    },
  });
  await writeFile(manifestPath, `${JSON.stringify(verifiedManifest, null, 2)}\n`, 'utf8');
  await uploadResumable({
    token,
    filePath: manifestPath,
    mimeType: 'application/json',
    fileId: manifestFile.id,
    metadata: {
      name: manifestFile.name,
      appProperties: {
        ...manifestFile.appProperties,
        restoreStatus: 'verified',
      },
    },
  });
  await githubSummary(`- Restauración verificada para la copia ${manifest.dump.fileName}.`);
  console.log('El manifiesto quedó marcado con una restauración verificada.');
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = {
  'init-folder': initFolder,
  'validate-source': validateSource,
  'validate-tool-version': validateToolVersion,
  'validate-restore': validateRestore,
  status,
  upload: uploadBackup,
  maintain,
  'download-latest': downloadLatest,
  'verify-plain': verifyPlainDump,
  'mark-restored': markRestored,
};

const handler = command ? commands[command] : undefined;
if (!handler) {
  throw new Error('Comando inválido. Usa init-folder, validate-source, validate-tool-version, validate-restore, status, upload, maintain, download-latest, verify-plain o mark-restored.');
}
await handler();
