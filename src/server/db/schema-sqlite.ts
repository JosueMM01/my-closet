/**
 * Esquema SQLite (desarrollo local y pruebas del backend).
 * Espejo exacto de schema-pg.ts: mismos campos y defaults.
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
    photoId: text('photo_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('garments_user_idx').on(table.userId),
    index('garments_updated_idx').on(table.updatedAt),
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
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('outfits_user_idx').on(table.userId),
    index('outfits_updated_idx').on(table.updatedAt),
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
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('calendar_user_date_idx').on(table.userId, table.date),
    index('calendar_updated_idx').on(table.updatedAt),
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
    version: integer('version').notNull().default(1),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    uniqueIndex('shares_grantor_invite_idx').on(table.grantorId, table.inviteToken),
    index('shares_updated_idx').on(table.updatedAt),
  ],
);

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(), // blob binario
  remoteUrl: text('remote_url'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
