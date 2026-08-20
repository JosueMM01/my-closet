/**
 * Configuracion de entorno del servidor, validada con Zod.
 * Sin variables obligatorias en desarrollo local: todos los proveedores
 * externos requieren seleccion explicita.
 */
import { z } from 'zod';

const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalHeaderSafeString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).max(1024).regex(/^[^\r\n]+$/, 'No se permiten saltos de línea').optional(),
);

const optionalSmtpPort = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().min(1).max(65_535).optional(),
);

const explicitBoolean = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalExplicitBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

export const serverEnvSchema = z
  .object({
    DATABASE_PROVIDER: z.enum(['sqlite', 'postgres']).default('sqlite'),
    DATABASE_URL: optionalEnvString,
    IMAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    CLOUDINARY_CLOUD_NAME: optionalEnvString,
    CLOUDINARY_API_KEY: optionalEnvString,
    CLOUDINARY_API_SECRET: optionalEnvString,
    GOOGLE_AUTH_ENABLED: explicitBoolean,
    PUBLIC_REGISTRATION_ENABLED: optionalExplicitBoolean,
    GOOGLE_CLIENT_ID: optionalEnvString,
    GOOGLE_CLIENT_SECRET: optionalEnvString,
    AUTH_SECRET: optionalEnvString,
    NEXT_PUBLIC_APP_URL: optionalEnvString,
    EMAIL_PROVIDER: z.enum(['disabled', 'capture', 'smtp']).default('disabled'),
    EMAIL_FROM: optionalHeaderSafeString,
    SMTP_HOST: optionalHeaderSafeString,
    SMTP_PORT: optionalSmtpPort,
    SMTP_SECURE: optionalExplicitBoolean,
    SMTP_USER: optionalHeaderSafeString,
    SMTP_PASSWORD: optionalHeaderSafeString,
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .superRefine((env, context) => {
    const cloudinaryCredentials = [
      env.CLOUDINARY_CLOUD_NAME,
      env.CLOUDINARY_API_KEY,
      env.CLOUDINARY_API_SECRET,
    ];
    const cloudinaryCredentialCount = cloudinaryCredentials.filter(Boolean).length;
    if (cloudinaryCredentialCount > 0 && cloudinaryCredentialCount < cloudinaryCredentials.length) {
      context.addIssue({
        code: 'custom',
        message: 'Las credenciales de Cloudinary deben configurarse como un grupo completo',
        path: ['CLOUDINARY_CLOUD_NAME'],
      });
    }
    if (env.IMAGE_PROVIDER === 'cloudinary' && cloudinaryCredentialCount === 0) {
      context.addIssue({
        code: 'custom',
        message: 'IMAGE_PROVIDER=cloudinary requiere las credenciales de Cloudinary',
        path: ['IMAGE_PROVIDER'],
      });
    }

    const googleCredentials = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET];
    const googleCredentialCount = googleCredentials.filter(Boolean).length;
    if (googleCredentialCount > 0 && googleCredentialCount < googleCredentials.length) {
      context.addIssue({
        code: 'custom',
        message: 'Las credenciales de Google deben configurarse como un grupo completo',
        path: ['GOOGLE_CLIENT_ID'],
      });
    }
    if (env.GOOGLE_AUTH_ENABLED && googleCredentialCount === 0) {
      context.addIssue({
        code: 'custom',
        message: 'GOOGLE_AUTH_ENABLED=true requiere las credenciales de Google',
        path: ['GOOGLE_AUTH_ENABLED'],
      });
    }

    if (env.DATABASE_PROVIDER === 'postgres') {
      if (!env.DATABASE_URL) {
        context.addIssue({
          code: 'custom',
          message: 'DATABASE_PROVIDER=postgres requiere DATABASE_URL',
          path: ['DATABASE_URL'],
        });
      } else if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)) {
        context.addIssue({
          code: 'custom',
          message: 'DATABASE_URL debe usar postgres:// o postgresql://',
          path: ['DATABASE_URL'],
        });
      }
    }

    const smtpConfiguration = [
      env.EMAIL_FROM,
      env.SMTP_HOST,
      env.SMTP_PORT,
      env.SMTP_SECURE,
      env.SMTP_USER,
      env.SMTP_PASSWORD,
    ];
    const smtpConfigurationCount = smtpConfiguration.filter(
      (value) => value !== undefined,
    ).length;
    if (smtpConfigurationCount > 0 && smtpConfigurationCount < smtpConfiguration.length) {
      context.addIssue({
        code: 'custom',
        message: 'La configuración SMTP debe proporcionarse como un grupo completo',
        path: ['SMTP_HOST'],
      });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && smtpConfigurationCount === 0) {
      context.addIssue({
        code: 'custom',
        message: 'EMAIL_PROVIDER=smtp requiere la configuración SMTP',
        path: ['EMAIL_PROVIDER'],
      });
    }

    let appUrlIsValid = false;
    if (env.NEXT_PUBLIC_APP_URL) {
      try {
        const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
        appUrlIsValid = appUrl.protocol === 'http:' || appUrl.protocol === 'https:';
      } catch {
        appUrlIsValid = false;
      }
      if (!appUrlIsValid) {
        context.addIssue({
          code: 'custom',
          message: 'NEXT_PUBLIC_APP_URL debe ser una URL HTTP(S) válida',
          path: ['NEXT_PUBLIC_APP_URL'],
        });
      }
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !appUrlIsValid) {
      context.addIssue({
        code: 'custom',
        message: 'EMAIL_PROVIDER=smtp requiere NEXT_PUBLIC_APP_URL',
        path: ['NEXT_PUBLIC_APP_URL'],
      });
    }
  })
  .transform((env) => ({
    ...env,
    // Contrato: producción es invite-only salvo habilitación explícita.
    PUBLIC_REGISTRATION_ENABLED:
      env.PUBLIC_REGISTRATION_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type DatabaseDialect = ServerEnv['DATABASE_PROVIDER'];

/** Parseo puro para validar configuraciones sin leer ni mutar el cache global. */
export function parseServerEnv(input: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(input);
}

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(process.env);
  }
  return cached;
}

export function getDatabaseDialect(env: ServerEnv = getEnv()): DatabaseDialect {
  return env.DATABASE_PROVIDER;
}

/** SQLite local por defecto: workspace-local, ignorado por Git. */
export function getSqliteUrl(env: ServerEnv = getEnv()): string {
  return env.DATABASE_URL?.startsWith('file:')
    ? env.DATABASE_URL
    : 'file:./data/my-closet.db';
}

// No hay rutas OAuth de Google todavia; las credenciales no implican capacidad.
const GOOGLE_AUTH_IMPLEMENTATION_READY = false;

export function isGoogleEnabled(env: ServerEnv = getEnv()): boolean {
  return Boolean(
    env.GOOGLE_AUTH_ENABLED &&
      GOOGLE_AUTH_IMPLEMENTATION_READY &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET,
  );
}

export function isPublicRegistrationEnabled(env: ServerEnv = getEnv()): boolean {
  return env.PUBLIC_REGISTRATION_ENABLED;
}

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function getCloudinaryCredentials(
  env: ServerEnv = getEnv(),
): CloudinaryCredentials | null {
  if (env.IMAGE_PROVIDER !== 'cloudinary') return null;
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('La configuracion de Cloudinary no fue validada correctamente');
  }
  return { cloudName, apiKey, apiSecret };
}

export function isCloudinaryEnabled(env: ServerEnv = getEnv()): boolean {
  return getCloudinaryCredentials(env) !== null;
}

export function isProduction(env: ServerEnv = getEnv()): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * AUTH_SECRET: en desarrollo usa un valor local inseguro. En produccion es
 * obligatorio y su ausencia falla antes de emitir o validar sesiones.
 */
export function getAuthSecret(): string {
  const env = getEnv();
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (isProduction(env)) {
    throw new Error('AUTH_SECRET es obligatorio en produccion');
  }
  return 'dev-insecure-auth-secret-change-me';
}
