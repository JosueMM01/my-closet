/**
 * Fabrica de conexiones Drizzle segun proveedor.
 *  - SQLite (desarrollo local): better-sqlite3 + DDL idempotente.
 *  - PostgreSQL/Neon: postgres.js + migraciones Drizzle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import { getEnv, getSqliteUrl, type ServerEnv } from '@/server/env';
import { uuid } from '@/lib/domain/ids';
import { hashPassword } from '@/server/auth/password';
import * as pgSchema from './schema-pg';
import * as sqliteSchema from './schema-sqlite';

export type SqliteDB = BetterSQLite3Database<typeof sqliteSchema>;
export type PostgresDB = PostgresJsDatabase<typeof pgSchema>;

export interface SqliteServerDB {
  dialect: 'sqlite';
  sqlite: SqliteDB;
  raw: import('better-sqlite3').Database;
}

export interface PostgresServerDB {
  dialect: 'postgres';
  postgres: PostgresDB;
  raw: Sql;
}

export type ServerDB = SqliteServerDB | PostgresServerDB;

let instance: ServerDB | null = null;

function ensureDataDir(sqlitePath: string): void {
  const dir = path.dirname(sqlitePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class DatabaseProviderNotImplementedError extends Error {
  constructor(provider: ServerEnv['DATABASE_PROVIDER']) {
    super(`El proveedor de base de datos "${provider}" no esta implementado`);
    this.name = 'DatabaseProviderNotImplementedError';
  }
}

export async function createServerDB(env: ServerEnv): Promise<ServerDB> {
  if (env.DATABASE_PROVIDER === 'postgres') {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL es obligatorio para PostgreSQL');
    }
    const { default: postgres } = await import('postgres');
    const raw = postgres(env.DATABASE_URL, {
      // Neon ya aporta PgBouncer en la URL pooled; evitar doble pooling.
      max: 1,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 20,
    });
    const db = drizzlePostgres(raw, { schema: pgSchema });
    try {
      await db.execute(sql`select 1`);
      await ensureBootstrapAdminPostgres(db, env);
      return { dialect: 'postgres', postgres: db, raw };
    } catch (error) {
      await raw.end({ timeout: 5 });
      throw error;
    }
  }

  const sqlitePath = getSqliteUrl(env).slice('file:'.length);
  ensureDataDir(sqlitePath);

  const { default: Database } = await import('better-sqlite3');
  const raw = new Database(sqlitePath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const db = drizzleSqlite({ client: raw, schema: sqliteSchema });
  ensureSqliteSchema(db, raw);
  await ensureBootstrapAdmin(raw, env);
  return { dialect: 'sqlite', sqlite: db, raw };
}

export async function getServerDB(): Promise<ServerDB> {
  if (!instance) {
    instance = await createServerDB(getEnv());
  }
  return instance;
}

/**
 * DDL idempotente para SQLite local (equivalente en runtime a las
 * migraciones de drizzle-kit; PostgreSQL usará las migraciones SQL).
 */
function ensureSqliteSchema(
  db: SqliteDB,
  raw: import('better-sqlite3').Database,
): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    admin_slot INTEGER UNIQUE,
    profile_image_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((role = 'ADMIN' AND status = 'ACTIVE' AND admin_slot IN (1, 2)) OR ((role <> 'ADMIN' OR status <> 'ACTIVE') AND admin_slot IS NULL))
  )`);
  const userColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(users)').all().map((column) => column.name),
  );
  const missingUserColumns = [
    ['role', "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'"],
    ['status', "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'"],
    ['admin_slot', 'ALTER TABLE users ADD COLUMN admin_slot INTEGER'],
    ['profile_image_id', 'ALTER TABLE users ADD COLUMN profile_image_id TEXT'],
  ] as const;
  for (const [name, ddl] of missingUserColumns) {
    if (!userColumns.has(name)) raw.exec(ddl);
  }
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_admin_slot_unique ON users(admin_slot)`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS users_admin_state_insert
    BEFORE INSERT ON users
    WHEN NOT (
      (NEW.role = 'ADMIN' AND NEW.status = 'ACTIVE' AND NEW.admin_slot IN (1, 2))
      OR ((NEW.role <> 'ADMIN' OR NEW.status <> 'ACTIVE') AND NEW.admin_slot IS NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'Estado administrativo invalido'); END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS users_admin_state_update
    BEFORE UPDATE OF role, status, admin_slot ON users
    WHEN NOT (
      (NEW.role = 'ADMIN' AND NEW.status = 'ACTIVE' AND NEW.admin_slot IN (1, 2))
      OR ((NEW.role <> 'ADMIN' OR NEW.status <> 'ACTIVE') AND NEW.admin_slot IS NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'Estado administrativo invalido'); END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS users_last_admin_update
    BEFORE UPDATE OF role, status ON users
    WHEN OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
      AND (NEW.role <> 'ADMIN' OR NEW.status <> 'ACTIVE')
      AND (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE') <= 1
    BEGIN SELECT RAISE(ABORT, 'No se puede quitar el ultimo administrador activo'); END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS users_last_admin_delete
    BEFORE DELETE ON users
    WHEN OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
      AND (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE') <= 1
    BEGIN SELECT RAISE(ABORT, 'No se puede eliminar el ultimo administrador activo'); END`);
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS auth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider = 'GOOGLE'),
    provider_subject TEXT NOT NULL,
    provider_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_subject),
    UNIQUE (user_id, provider)
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_subject_unique
    ON auth_accounts(provider, provider_subject)`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_user_provider_unique
    ON auth_accounts(user_id, provider)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS account_invitations (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
    created_by TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at TEXT,
    accepted_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS account_invitations_email_idx ON account_invitations(email)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS account_invitations_created_by_idx ON account_invitations(created_by)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS garments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    favorite INTEGER NOT NULL DEFAULT 0,
    photo_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  const garmentColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(garments)').all().map((column) => column.name),
  );
  if (!garmentColumns.has('favorite')) {
    raw.exec('ALTER TABLE garments ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }
  if (!garmentColumns.has('server_updated_at')) {
    raw.exec("ALTER TABLE garments ADD COLUMN server_updated_at TEXT NOT NULL DEFAULT ''");
    raw.exec("UPDATE garments SET server_updated_at = updated_at WHERE server_updated_at = ''");
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS garments_user_idx ON garments(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS garments_updated_idx ON garments(updated_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS garments_user_server_updated_idx ON garments(user_id, server_updated_at, id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS outfits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shareable_id TEXT NOT NULL,
    name TEXT,
    notes TEXT,
    slots TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS outfits_user_idx ON outfits(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS outfits_updated_idx ON outfits(updated_at)`);
  const outfitColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(outfits)').all().map((column) => column.name),
  );
  if (!outfitColumns.has('server_updated_at')) {
    raw.exec("ALTER TABLE outfits ADD COLUMN server_updated_at TEXT NOT NULL DEFAULT ''");
    raw.exec("UPDATE outfits SET server_updated_at = updated_at WHERE server_updated_at = ''");
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS outfits_user_server_updated_idx ON outfits(user_id, server_updated_at, id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS calendar_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    outfit_id TEXT NOT NULL,
    worn_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS calendar_user_date_idx ON calendar_entries(user_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS calendar_updated_idx ON calendar_entries(updated_at)`);
  const calendarColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(calendar_entries)').all().map((column) => column.name),
  );
  if (!calendarColumns.has('server_updated_at')) {
    raw.exec("ALTER TABLE calendar_entries ADD COLUMN server_updated_at TEXT NOT NULL DEFAULT ''");
    raw.exec("UPDATE calendar_entries SET server_updated_at = updated_at WHERE server_updated_at = ''");
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS calendar_user_server_updated_idx ON calendar_entries(user_id, server_updated_at, id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS wardrobe_shares (
    id TEXT PRIMARY KEY,
    grantor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grantee_id TEXT,
    grantee_email TEXT,
    permission TEXT NOT NULL,
    invite_token TEXT NOT NULL,
    accepted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS shares_grantor_invite_idx ON wardrobe_shares(grantor_id, invite_token)`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS shares_invite_token_idx ON wardrobe_shares(invite_token)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS shares_updated_idx ON wardrobe_shares(updated_at)`);
  const shareColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(wardrobe_shares)').all().map((column) => column.name),
  );
  if (!shareColumns.has('server_updated_at')) {
    raw.exec("ALTER TABLE wardrobe_shares ADD COLUMN server_updated_at TEXT NOT NULL DEFAULT ''");
    raw.exec("UPDATE wardrobe_shares SET server_updated_at = updated_at WHERE server_updated_at = ''");
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS shares_grantor_server_updated_idx ON wardrobe_shares(grantor_id, server_updated_at, id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS shares_grantee_server_updated_idx ON wardrobe_shares(grantee_id, server_updated_at, id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    byte_size INTEGER NOT NULL,
    data BLOB,
    remote_url TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'local',
    storage_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const imageColumns = new Set(
    raw.prepare<[], { name: string }>('PRAGMA table_info(images)').all().map((column) => column.name),
  );
  const missingImageColumns = [
    ['width', 'ALTER TABLE images ADD COLUMN width INTEGER'],
    ['height', 'ALTER TABLE images ADD COLUMN height INTEGER'],
    ['storage_provider', "ALTER TABLE images ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'local'"],
    ['storage_key', 'ALTER TABLE images ADD COLUMN storage_key TEXT'],
    ['updated_at', "ALTER TABLE images ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, ddl] of missingImageColumns) {
    if (!imageColumns.has(name)) raw.exec(ddl);
  }
  raw.exec("UPDATE images SET updated_at = created_at WHERE updated_at = '' OR updated_at IS NULL");
  const imageDataColumn = raw
    .prepare<[], { name: string; notnull: number }>('PRAGMA table_info(images)')
    .all()
    .find((column) => column.name === 'data');
  if (imageDataColumn?.notnull === 1) {
    raw.transaction(() => {
      raw.exec('ALTER TABLE images RENAME TO images_before_nullable_data');
      raw.exec(`CREATE TABLE images (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        byte_size INTEGER NOT NULL,
        data BLOB,
        remote_url TEXT,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        storage_key TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      raw.exec(`INSERT INTO images (
        id, user_id, mime_type, width, height, byte_size, data, remote_url,
        storage_provider, storage_key, created_at, updated_at
      ) SELECT
        id, user_id, mime_type, width, height, byte_size, data, remote_url,
        storage_provider, storage_key, created_at, updated_at
      FROM images_before_nullable_data`);
      raw.exec('DROP TABLE images_before_nullable_data');
    })();
  }
}

async function ensureBootstrapAdmin(
  raw: import('better-sqlite3').Database,
  env: ServerEnv,
): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = raw.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM users').get();
  if ((existing?.count ?? 0) !== 0) return;

  const passwordHash = await hashPassword(password);
  raw.transaction(() => {
    raw.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, role, status, admin_slot,
        profile_image_id, created_at
      )
      SELECT ?, ?, 'Administrador', ?, 'ADMIN', 'ACTIVE', 1, NULL, ?
      WHERE NOT EXISTS (SELECT 1 FROM users)
    `).run(uuid(), email, passwordHash, new Date().toISOString());
  }).immediate();
}

async function ensureBootstrapAdminPostgres(
  db: PostgresDB,
  env: ServerEnv,
): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    // Serializa bootstraps concurrentes de distintas instancias.
    await tx.execute(sql`select pg_advisory_xact_lock(728194512)`);
    const existing = await tx.select({ id: pgSchema.users.id }).from(pgSchema.users).limit(1);
    if (existing[0]) return;
    await tx.insert(pgSchema.users).values({
      id: uuid(),
      email,
      displayName: 'Administrador',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      adminSlot: 1,
      profileImageId: null,
    });
  });
}

export async function closeServerDB(): Promise<void> {
  if (instance?.dialect === 'sqlite') {
    instance.raw.close();
  } else if (instance?.dialect === 'postgres') {
    await instance.raw.end({ timeout: 5 });
  }
  instance = null;
}

/**
 * Acceso tipado a la BD SQLite (desarrollo). En producción PostgreSQL, los
 * repositorios espejo (schema-pg) cumplen el mismo contrato — ver
 * docs/ARCHITECTURE.md.
 */
export async function getSqlite(): Promise<SqliteDB> {
  const db = await getServerDB();
  if (db.dialect !== 'sqlite') {
    throw new DatabaseProviderNotImplementedError(db.dialect);
  }
  return db.sqlite;
}

export async function getPostgres(): Promise<PostgresDB> {
  const db = await getServerDB();
  if (db.dialect !== 'postgres') {
    throw new DatabaseProviderNotImplementedError(db.dialect);
  }
  return db.postgres;
}

export { pgSchema, sqliteSchema };
