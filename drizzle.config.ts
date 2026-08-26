import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Drizzle Kit loads `.env` before evaluating this file. Local database commands
// must prefer `.env.local` so a production import file cannot silently win.
config({ path: '.env.local', override: true, quiet: true });

const url = process.env.DATABASE_URL ?? '';
const isPostgres = url.startsWith('postgres://') || url.startsWith('postgresql://');
const migrationUrl = isPostgres ? (process.env.DATABASE_URL_UNPOOLED ?? url) : url;

export default defineConfig({
  dialect: isPostgres ? 'postgresql' : 'sqlite',
  schema: isPostgres ? './src/server/db/schema-pg.ts' : './src/server/db/schema-sqlite.ts',
  out: isPostgres ? './drizzle/pg' : './drizzle/sqlite',
  dbCredentials: isPostgres
    ? { url: migrationUrl }
    : { url: url.startsWith('file:') ? url.slice('file:'.length) : './data/my-closet.db' },
  verbose: true,
  strict: true,
});
