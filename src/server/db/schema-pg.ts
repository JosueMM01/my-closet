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
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('USER'),
    status: text('status').notNull().default('ACTIVE'),
    adminSlot: integer('admin_slot'),
    profileImageId: text('profile_image_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
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

export const accountInvitations = pgTable(
  'account_invitations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('account_invitations_email_idx').on(table.email),
    index('account_invitations_created_by_idx').on(table.createdBy),
    check('account_invitations_role_check', sql`${table.role} IN ('USER', 'ADMIN')`),
  ],
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
    favorite: boolean('favorite').notNull().default(false),
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
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size').notNull(),
  data: text('data'), // base64 solo para proveedores que almacenan binario en BD
  remoteUrl: text('remote_url'),
  storageProvider: text('storage_provider').notNull().default('local'),
  storageKey: text('storage_key'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
