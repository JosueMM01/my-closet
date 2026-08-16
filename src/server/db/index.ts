/**
 * Fábrica de conexiones Drizzle según dialecto.
 *  - SQLite (desarrollo local): better-sqlite3 + DDL idempotente.
 *  - PostgreSQL (producción futura, Neon): postgres.js — se activa solo
 *    cuando DATABASE_URL apunta a postgres://… Sin esa URL nunca se conecta.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from './schema-sqlite';

export type SqliteDB = BetterSQLite3Database<typeof sqliteSchema>;

export interface ServerDB {
  dialect: 'sqlite' | 'postgres';
  sqlite?: SqliteDB;
  raw?: import('better-sqlite3').Database;
}

let instance: ServerDB | null = null;

function ensureDataDir(sqlitePath: string): void {
  const dir = path.dirname(sqlitePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function getServerDB(): Promise<ServerDB> {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  const isPostgres = Boolean(url?.startsWith('postgres://') || url?.startsWith('postgresql://'));

  if (isPostgres && url) {
    const [{ drizzle }, postgres] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    const client = postgres.default(url, { max: 5 });
    const db = drizzle(client);
    instance = { dialect: 'postgres', sqlite: db as unknown as SqliteDB };
    return instance;
  }

  const sqlitePath = url?.startsWith('file:')
    ? url.slice('file:'.length)
    : './data/my-closet.db';
  ensureDataDir(sqlitePath);

  const { default: Database } = await import('better-sqlite3');
  const raw = new Database(sqlitePath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const db = drizzleSqlite({ client: raw, schema: sqliteSchema });
  ensureSqliteSchema(db);
  instance = { dialect: 'sqlite', sqlite: db, raw };
  return instance;
}

/**
 * DDL idempotente para SQLite local (equivalente en runtime a las
 * migraciones de drizzle-kit; PostgreSQL usará las migraciones SQL).
 */
function ensureSqliteSchema(db: SqliteDB): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
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
    photo_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS garments_user_idx ON garments(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS garments_updated_idx ON garments(updated_at)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS outfits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shareable_id TEXT NOT NULL,
    name TEXT,
    notes TEXT,
    slots TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS outfits_user_idx ON outfits(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS outfits_updated_idx ON outfits(updated_at)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS calendar_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    outfit_id TEXT NOT NULL,
    worn_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS calendar_user_date_idx ON calendar_entries(user_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS calendar_updated_idx ON calendar_entries(updated_at)`);
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
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS shares_grantor_invite_idx ON wardrobe_shares(grantor_id, invite_token)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS shares_updated_idx ON wardrobe_shares(updated_at)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    data BLOB NOT NULL,
    remote_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function closeServerDB(): Promise<void> {
  if (instance?.raw) {
    instance.raw.close();
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
  if (!db.sqlite) {
    throw new Error('El backend está configurado con PostgreSQL; usa los repositorios PG');
  }
  return db.sqlite;
}

export { sqliteSchema };
