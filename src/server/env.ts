/**
 * Configuración de entorno del servidor, validada con Zod.
 * Sin variables obligatorias en desarrollo local: SQLite por defecto.
 */
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export type DatabaseDialect = 'sqlite' | 'postgres';

export function getDatabaseDialect(): DatabaseDialect {
  const url = getEnv().DATABASE_URL;
  if (!url) return 'sqlite';
  return url.startsWith('postgres://') || url.startsWith('postgresql://') ? 'postgres' : 'sqlite';
}

/** SQLite local por defecto: workspace-local, ignorado por Git. */
export function getSqliteUrl(): string {
  return getEnv().DATABASE_URL?.startsWith('file:') ? getEnv().DATABASE_URL! : 'file:./data/my-closet.db';
}

export function isGoogleEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isCloudinaryEnabled(): boolean {
  const env = getEnv();
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * AUTH_SECRET: en desarrollo se genera uno estable por instalación
 * (persistido en data/) para que las sesiones sobrevivan reinicios.
 * En producción es obligatorio.
 */
export function getAuthSecret(): string {
  const env = getEnv();
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (isProduction()) {
    throw new Error('AUTH_SECRET es obligatorio en producción');
  }
  return 'dev-insecure-auth-secret-change-me';
}
