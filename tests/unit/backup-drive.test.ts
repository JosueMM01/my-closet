import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_APP_ID, type DriveBackupFile } from '../../scripts/backups/policy.mts';

let directory: string;
let originalArguments: string[];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'my-closet-backup-test-'));
  originalArguments = [...process.argv];
  vi.resetModules();
  for (const [name, value] of Object.entries({
    GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'fixture-client',
    GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'fixture-refresh',
    GOOGLE_DRIVE_BACKUP_FOLDER_ID: 'fixture-folder',
    BACKUP_DATABASE_NAME: 'neondb',
    BACKUP_RETENTION_COUNT: '2',
    GITHUB_OUTPUT: '',
    GITHUB_STEP_SUMMARY: '',
    BACKUP_DUMP_PATH: path.join(directory, 'database.dump'),
    BACKUP_ARCHIVE_PATH: path.join(directory, 'database.dump.age'),
    BACKUP_MANIFEST_PATH: path.join(directory, 'manifest.json'),
    BACKUP_SERVER_VERSION_PATH: path.join(directory, 'server.txt'),
    BACKUP_PG_DUMP_VERSION_PATH: path.join(directory, 'dump-version.txt'),
  })) vi.stubEnv(name, value);
  await Promise.all([
    writeFile(path.join(directory, 'database.dump'), 'synthetic-dump'),
    writeFile(path.join(directory, 'database.dump.age'), 'synthetic-ciphertext'),
    writeFile(path.join(directory, 'server.txt'), '17.6'),
    writeFile(path.join(directory, 'dump-version.txt'), 'pg_dump 17.6'),
  ]);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  process.argv = originalArguments;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

async function command(name: string): Promise<void> {
  vi.resetModules();
  process.argv[2] = name;
  await import('../../scripts/backups/google-drive-backup.mts');
}

function mockDrive(corruptManifest = false) {
  const files: DriveBackupFile[] = [];
  const bodies = new Map<string, Buffer>();
  const pending = new Map<string, {
    name: string;
    appProperties: Record<string, string>;
  }>();
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'fixture-access', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && init.method === 'POST') {
      const file: DriveBackupFile = {
        id: `folder-${files.length + 1}`, createdTime: new Date().toISOString(),
        ...JSON.parse(String(init.body)),
      };
      files.push(file);
      return Response.json(file);
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
      const id = `file-${pending.size + 1}`;
      pending.set(id, JSON.parse(String(init.body)));
      return new Response(null, { headers: { location: `https://www.googleapis.com/upload/fixture/${id}` } });
    }
    if (url.startsWith('https://www.googleapis.com/upload/fixture/')) {
      const id = url.split('/').at(-1)!;
      const metadata = pending.get(id)!;
      const contents = init.body as Buffer;
      bodies.set(id, contents);
      const file: DriveBackupFile = {
        id,
        ...metadata,
        createdTime: new Date().toISOString(),
        size: String(contents.length),
        md5Checksum: corruptManifest && metadata.appProperties.kind === 'manifest'
          ? '0'.repeat(32) : createHash('md5').update(contents).digest('hex'),
      };
      files.push(file);
      return Response.json(file);
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/') && new URL(url).searchParams.get('alt') === 'media') {
      const body = bodies.get(new URL(url).pathname.split('/').at(-1)!);
      if (!body) throw new Error('Missing fixture download');
      return new Response(new Uint8Array(body));
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const query = new URL(url).searchParams.get('q') ?? '';
      const parent = /^'([^']+)' in parents/.exec(query)?.[1];
      return Response.json({ files: files.filter(file => file.parents?.includes(parent ?? '')
        || (!file.parents && parent === 'fixture-folder')) });
    }
    if (init.method === 'PATCH') {
      const target = files.find((file) => file.id === url.split('/').at(-1));
      if (!target) throw new Error('Missing fixture file');
      Object.assign(target, JSON.parse(String(init.body)));
      return Response.json(target);
    }
    if (init.method === 'DELETE') {
      const index = files.findIndex(file => file.id === url.split('/').at(-1));
      if (index < 0) throw new Error('Missing fixture delete');
      files.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected mocked request');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { files, fetchMock };
}

describe('flujo Drive del respaldo sin servicios reales', () => {
  it('publica la generación solo después de verificar archivo y manifiesto', async () => {
    const { files, fetchMock } = mockDrive();
    await command('upload');
    expect(files).toHaveLength(3);
    expect(files.every((file) => file.appProperties?.app === BACKUP_APP_ID
      && file.appProperties.status === 'complete')).toBe(true);
    const manifestStart = fetchMock.mock.calls.find(([url, init]) =>
      url.startsWith('https://www.googleapis.com/upload/drive/v3/files?')
      && String(init?.body).includes('"kind":"manifest"'));
    expect(JSON.parse(String(manifestStart?.[1]?.body)).appProperties.status).toBe('uploading');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const folder = files.find(file => file.appProperties?.kind === 'generation')!;
    expect(folder.name).toMatch(/^respaldo-\d{4}-\d{2}-\d{2}T/);
    expect(files.filter(file => file.id !== folder.id).every(file => file.parents?.[0] === folder.id)).toBe(true);
  });

  it('la tercera generación retira archivos y carpeta de la primera, conservando las dos últimas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { files } = mockDrive();
    await command('upload');
    const firstFolderId = files.find(file => file.appProperties?.kind === 'generation')!.id;
    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
    await command('upload');
    expect(files.filter(file => file.appProperties?.kind === 'generation')).toHaveLength(2);
    vi.setSystemTime(new Date('2026-01-17T00:00:00Z'));
    await command('upload');
    expect(files).toHaveLength(6);
    expect(files.some(file => file.id === firstFolderId || file.parents?.includes(firstFolderId))).toBe(false);
  });

  it.each(['generation-folder', 'legacy-flat'])('descarga y verifica la copia con estructura %s', async layout => {
    const { files } = mockDrive();
    await command('upload');
    if (layout === 'legacy-flat') {
      const folderIndex = files.findIndex(file => file.appProperties?.kind === 'generation');
      files.splice(folderIndex, 1);
      for (const file of files) file.parents = ['fixture-folder'];
    }
    await writeFile(path.join(directory, 'database.dump.age'), 'replace-this-corrupt-local-file');
    await command('download-latest');
    expect(await readFile(path.join(directory, 'database.dump.age'), 'utf8')).toBe('synthetic-ciphertext');
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    expect(manifest.dump.encryptedSha256).toBe(createHash('sha256').update('synthetic-ciphertext').digest('hex'));
  });

  it('mantenimiento no elimina carpetas que contienen archivos ajenos', async () => {
    const { files, fetchMock } = mockDrive();
    files.push({ id: 'folder-kept', name: 'respaldo-incompleto', createdTime: '2020-01-01T00:00:00Z',
      mimeType: 'application/vnd.google-apps.folder', parents: ['fixture-folder'],
      appProperties: { app: BACKUP_APP_ID, kind: 'generation', runId: 'old', status: 'uploading' } });
    files.push({ id: 'unmanaged', name: 'archivo-ajeno', createdTime: '2020-01-01T00:00:00Z', parents: ['folder-kept'] });
    await command('maintain');
    expect(files).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('un manifiesto corrupto no se publica y nunca activa borrado/rotación', async () => {
    const { files, fetchMock } = mockDrive(true);
    await expect(command('upload')).rejects.toThrow(/tamaño o MD5/);
    expect(files.find((file) => file.appProperties?.kind === 'manifest')?.appProperties?.status)
      .toBe('uploading');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('la revocación OAuth detiene el flujo antes de tocar Drive y no imprime tokens', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(command('upload')).rejects.toThrow('Google OAuth rechazó la renovación del token (400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each(['status', 'maintain', 'download-latest'])('invalid_grant en %s no toca copias existentes', async (operation) => {
    const fetchMock = vi.fn(async () => Response.json({
      error: 'invalid_grant', error_description: 'private-fixture-token',
    }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(command(operation)).rejects.toThrow('invalid_grant: autorización vencida o revocada');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each([
    { body: { error: 'invalid_client' }, message: 'no uses el cliente de Google Sign-In' },
    { body: { error: 'invalid_scope' }, message: 'revisa los permisos de Drive' },
    { body: { error: 'unknown-private-fixture-token', error_description: 'private-fixture-token' }, message: 'no se realizaron operaciones en Drive' },
  ])('diagnóstico OAuth acotado: $message', async ({ body, message }) => {
    const fetchMock = vi.fn(async () => Response.json(body, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    let failure: unknown;
    try { await command('status'); } catch (error) { failure = error; }
    expect(String(failure)).toContain(message);
    expect(String(failure)).not.toContain('private-fixture-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un rechazo OAuth con HTML no se imprime ni se confunde con JSON inválido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-fixture-token', { status: 503 })));
    await expect(command('status')).rejects.toThrow('Google OAuth rechazó la renovación del token (503). Revisa el estado');
  });
});
