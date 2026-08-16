/**
 * Esquema PostgreSQL (producción futura con Neon). Espejo de schema-sqlite.ts.
 *
 * Decisión de portabilidad: fechas y JSON se almacenan como texto ISO/JSON
 * en ambos dialectos para que la semántica de sincronización (comparación
 * lexicográfica de updatedAt) sea idéntica en SQLite y PostgreSQL.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const garments = pgTable(
  'garments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareableId: text('shareable_id').notNull(),
    name: text('name'),
    category: text('category').notNull(),
    colors: text('colors').notNull().default('[]'),
    brand: text('brand'),
    size: text('size'),
    notes: text('notes'),
    washingInstructions: text('washing_instructions'),
    dateAcquired: text('date_acquired'),
    archived: boolean('archived').notNull().default(false),
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

export const outfits = pgTable(
  'outfits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareableId: text('shareable_id').notNull(),
    name: text('name'),
    notes: text('notes'),
    slots: text('slots').notNull().default('[]'),
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

export const calendarEntries = pgTable(
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

export const wardrobeShares = pgTable(
  'wardrobe_shares',
  {
    id: text('id').primaryKey(),
    grantorId: text('grantor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    granteeId: text('grantee_id'),
    granteeEmail: text('grantee_email'),
    permission: text('permission').notNull(),
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

export const images = pgTable('images', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  data: text('data').notNull(), // base64 cuando no hay adaptador externo
  remoteUrl: text('remote_url'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
