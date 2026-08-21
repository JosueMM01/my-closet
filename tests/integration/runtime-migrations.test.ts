import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDB } from '@/server/db';
import { parseServerEnv } from '@/server/env';

let temporaryDirectory: string | null = null;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe('migraciones SQLite en runtime', () => {
  it('backfills favorite, añade metadatos y vuelve data nullable de forma idempotente', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'my-closet-migration-'));
    const databasePath = join(temporaryDirectory, 'legacy.db');
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE garments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        shareable_id TEXT NOT NULL,
        name TEXT,
        category TEXT NOT NULL,
        colors TEXT NOT NULL DEFAULT '[]',
        brand TEXT,
        size TEXT,
        notes TEXT,
        washing_instructions TEXT,
        date_acquired TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        photo_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );
      CREATE TABLE images (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        data BLOB NOT NULL,
        remote_url TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO users VALUES (
        '11111111-1111-4111-8111-111111111111', 'legacy@test.local', 'Legacy', 'hash',
        '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO garments (
        id, user_id, shareable_id, category, colors, created_at, updated_at
      ) VALUES (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        'tops', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const env = parseServerEnv({ DATABASE_URL: `file:${databasePath}` });
    const first = await createServerDB(env);
    if (first.dialect !== 'sqlite') throw new Error('Se esperaba SQLite');
    expect(first.raw.prepare('SELECT favorite FROM garments').get()).toEqual({ favorite: 0 });
    expect(
      first.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'")
        .get(),
    ).toBeTruthy();
    expect(
      first.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_accounts'")
        .get(),
    ).toBeTruthy();
    const dataColumn = first.raw
      .prepare('PRAGMA table_info(images)')
      .all()
      .find((column) => (column as { name: string }).name === 'data') as { notnull: number };
    expect(dataColumn.notnull).toBe(0);
    first.raw.close();

    const second = await createServerDB(env);
    if (second.dialect !== 'sqlite') throw new Error('Se esperaba SQLite');
    expect(() => second.raw.prepare(`
      INSERT INTO images (
        id, user_id, mime_type, width, height, byte_size, data, remote_url,
        storage_provider, storage_key, created_at, updated_at
      ) VALUES (?, ?, 'image/webp', 10, 10, 100, NULL, ?, 'cloudinary', NULL, ?, ?)
    `).run(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      'https://example.test/image.webp',
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    )).not.toThrow();
    second.raw.close();
  });
});
