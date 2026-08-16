import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? '';
const isPostgres = url.startsWith('postgres://') || url.startsWith('postgresql://');

export default defineConfig({
  dialect: isPostgres ? 'postgresql' : 'sqlite',
  schema: isPostgres ? './src/server/db/schema-pg.ts' : './src/server/db/schema-sqlite.ts',
  out: isPostgres ? './drizzle/pg' : './drizzle/sqlite',
  dbCredentials: isPostgres
    ? { url }
    : { url: url.startsWith('file:') ? url.slice('file:'.length) : './data/my-closet.db' },
  verbose: true,
  strict: true,
});
