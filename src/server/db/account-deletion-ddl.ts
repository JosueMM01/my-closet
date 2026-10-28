import type Database from 'better-sqlite3';

/** SQLite startup is idempotent. PostgreSQL receives equivalent reviewed migrations. */
export function ensureAccountDeletionSqlite(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS account_deletions (user_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_deletion_proofs (
      user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, session_hash TEXT NOT NULL,
      credential_hash TEXT NOT NULL, google_subject TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_deletion_jobs (
      image_id TEXT PRIMARY KEY, storage_provider TEXT NOT NULL, storage_key TEXT,
      remote_url TEXT, state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS image_deletion_jobs_due_idx ON image_deletion_jobs(state, next_attempt_at);
  `);
  // Only fixed, code-owned table/column names are interpolated into DDL.
  for (const [table, owner] of [
    ['users', 'id'], ['garments', 'user_id'], ['outfits', 'user_id'],
    ['calendar_entries', 'user_id'], ['images', 'user_id'],
    ['sessions', 'user_id'], ['auth_accounts', 'user_id'], ['password_reset_tokens', 'user_id'],
    ['email_change_tokens', 'user_id'], ['account_deletion_proofs', 'user_id'], ['wardrobe_shares', 'grantor_id'],
  ] as const) {
    for (const event of ['INSERT', 'UPDATE'] as const) {
      raw.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_deleted_account_${event.toLowerCase()}
        BEFORE ${event} ON ${table}
        WHEN EXISTS (SELECT 1 FROM account_deletions WHERE user_id = NEW.${owner})
        BEGIN SELECT RAISE(ABORT, 'ACCOUNT_DELETED'); END`);
    }
  }
  for (const event of ['INSERT', 'UPDATE'] as const) {
    raw.exec(`CREATE TRIGGER IF NOT EXISTS shares_deleted_grantee_${event.toLowerCase()}
      BEFORE ${event} ON wardrobe_shares
      WHEN EXISTS (SELECT 1 FROM account_deletions WHERE user_id=NEW.grantee_id)
      BEGIN SELECT RAISE(ABORT, 'ACCOUNT_DELETED'); END`);
  }
  for (const [table, photo] of [['garments', 'photo_id'], ['users', 'profile_image_id']] as const) {
    for (const event of ['INSERT', 'UPDATE'] as const) {
      raw.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_deleting_image_${event.toLowerCase()}
        BEFORE ${event} ON ${table}
        WHEN EXISTS (SELECT 1 FROM image_deletion_jobs
          WHERE image_id = NEW.${photo} AND state IN ('PROCESSING', 'DONE', 'BLOCKED'))
        BEGIN SELECT RAISE(ABORT, 'IMAGE_DELETING'); END`);
    }
  }
  for (const event of ['INSERT', 'UPDATE'] as const) {
    raw.exec(`CREATE TRIGGER IF NOT EXISTS images_deleting_asset_${event.toLowerCase()}
      BEFORE ${event} ON images
      WHEN EXISTS (SELECT 1 FROM image_deletion_jobs WHERE state IN ('PROCESSING', 'DONE', 'BLOCKED') AND
        (image_id = NEW.id OR (storage_provider = NEW.storage_provider AND storage_key = NEW.storage_key)
          OR (remote_url IS NOT NULL AND remote_url = NEW.remote_url)))
      BEGIN SELECT RAISE(ABORT, 'IMAGE_DELETING'); END`);
  }
}
