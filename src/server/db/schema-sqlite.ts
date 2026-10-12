/**
 * Esquema SQLite (desarrollo local y pruebas del backend).
 * Espejo exacto de schema-pg.ts: mismos campos y defaults.
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['USER', 'ADMIN'] }).notNull().default('USER'),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] }).notNull().default('ACTIVE'),
    adminSlot: integer('admin_slot'),
    profileImageId: text('profile_image_id'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('users_admin_slot_unique').on(table.adminSlot),
    check('users_role_check', sql`${table.role} IN ('USER', 'ADMIN')`),
    check('users_status_check', sql`${table.status} IN ('ACTIVE', 'DISABLED')`),
    check(
      'users_admin_state_check',
      sql`((${table.role} = 'ADMIN' AND ${table.status} = 'ACTIVE' AND ${table.adminSlot} IN (1, 2)) OR ((${table.role} <> 'ADMIN' OR ${table.status} <> 'ACTIVE') AND ${table.adminSlot} IS NULL))`,
    ),
  ],
);

export const rateLimitBuckets = sqliteTable('rate_limit_buckets', {
  keyHash: text('key_hash').primaryKey(),
  hits: integer('hits').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('rate_limit_buckets_expiry_idx').on(table.expiresAt)]);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 del token de la cookie
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['GOOGLE'] }).notNull(),
    providerSubject: text('provider_subject').notNull(),
    providerEmail: text('provider_email').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('auth_accounts_provider_subject_unique').on(
      table.provider,
      table.providerSubject,
    ),
    uniqueIndex('auth_accounts_user_provider_unique').on(table.userId, table.provider),
    check('auth_accounts_provider_check', sql`${table.provider} = 'GOOGLE'`),
  ],
);

export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('password_reset_tokens_user_idx').on(table.userId),
    index('password_reset_tokens_expiry_idx').on(table.expiresAt),
  ],
);

export const accountInvitations = sqliteTable(
  'account_invitations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    role: text('role', { enum: ['USER', 'ADMIN'] }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    revokedAt: text('revoked_at'),
    acceptedBy: text('accepted_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('account_invitations_email_idx').on(table.email),
    index('account_invitations_created_by_idx').on(table.createdBy),
    check('account_invitations_role_check', sql`${table.role} IN ('USER', 'ADMIN')`),
  ],
);

export const garments = sqliteTable(
  'garments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareableId: text('shareable_id').notNull(),
    name: text('name'),
    category: text('category').notNull(),
    colors: text('colors').notNull().default('[]'), // JSON array
    brand: text('brand'),
    size: text('size'),
    notes: text('notes'),
    washingInstructions: text('washing_instructions'),
    dateAcquired: text('date_acquired'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    photoId: text('photo_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    serverUpdatedAt: text('server_updated_at').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('garments_user_idx').on(table.userId),
    index('garments_updated_idx').on(table.updatedAt),
    index('garments_user_server_updated_idx').on(table.userId, table.serverUpdatedAt, table.id),
  ],
);

export const outfits = sqliteTable(
  'outfits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareableId: text('shareable_id').notNull(),
    name: text('name'),
    notes: text('notes'),
    slots: text('slots').notNull().default('[]'), // JSON array
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    serverUpdatedAt: text('server_updated_at').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('outfits_user_idx').on(table.userId),
    index('outfits_updated_idx').on(table.updatedAt),
    index('outfits_user_server_updated_idx').on(table.userId, table.serverUpdatedAt, table.id),
  ],
);

export const calendarEntries = sqliteTable(
  'calendar_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    outfitId: text('outfit_id').notNull(),
    wornAt: text('worn_at'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    serverUpdatedAt: text('server_updated_at').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('calendar_user_date_idx').on(table.userId, table.date),
    index('calendar_updated_idx').on(table.updatedAt),
    index('calendar_user_server_updated_idx').on(table.userId, table.serverUpdatedAt, table.id),
  ],
);

export const wardrobeShares = sqliteTable(
  'wardrobe_shares',
  {
    id: text('id').primaryKey(),
    grantorId: text('grantor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    granteeId: text('grantee_id'),
    granteeEmail: text('grantee_email'),
    permission: text('permission', { enum: ['VIEW', 'MANAGE'] }).notNull(),
    inviteToken: text('invite_token').notNull(),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    serverUpdatedAt: text('server_updated_at').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    uniqueIndex('shares_grantor_invite_idx').on(table.grantorId, table.inviteToken),
    uniqueIndex('shares_invite_token_idx').on(table.inviteToken),
    index('shares_updated_idx').on(table.updatedAt),
    index('shares_grantor_server_updated_idx').on(table.grantorId, table.serverUpdatedAt, table.id),
    index('shares_grantee_server_updated_idx').on(table.granteeId, table.serverUpdatedAt, table.id),
  ],
);

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size').notNull(),
  data: blob('data', { mode: 'buffer' }), // null cuando el proveedor remoto conserva el binario
  remoteUrl: text('remote_url'),
  storageProvider: text('storage_provider', { enum: ['local', 'cloudinary'] }).notNull().default('local'),
  storageKey: text('storage_key'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
