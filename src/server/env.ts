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

const optionalBootstrapEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().toLowerCase().pipe(z.email().max(120)).optional(),
);

const optionalBootstrapPassword = z.preprocess(
  (value) => (typeof value === 'string' && value === '' ? undefined : value),
  z.string().min(8).max(128).optional(),
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
    DATABASE_URL_UNPOOLED: optionalEnvString,
    IMAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    CLOUDINARY_CLOUD_NAME: optionalEnvString,
    CLOUDINARY_API_KEY: optionalEnvString,
    CLOUDINARY_API_SECRET: optionalEnvString,
    CLOUDINARY_FOLDER_PREFIX: z.enum(['my-closet', 'my-closet-preview', 'my-closet-staging']).optional(),
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
    GOOGLE_AUTH_ENABLED: explicitBoolean,
    PUBLIC_REGISTRATION_ENABLED: explicitBoolean,
    GOOGLE_CLIENT_ID: optionalEnvString,
    GOOGLE_CLIENT_SECRET: optionalEnvString,
    AUTH_SECRET: optionalEnvString,
    BOOTSTRAP_ADMIN_EMAIL: optionalBootstrapEmail,
    BOOTSTRAP_ADMIN_PASSWORD: optionalBootstrapPassword,
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
    if (env.VERCEL_ENV === 'preview' && env.CLOUDINARY_FOLDER_PREFIX === 'my-closet') {
      context.addIssue({
        code: 'custom',
        message: 'Preview no puede usar la carpeta Cloudinary de producción',
        path: ['CLOUDINARY_FOLDER_PREFIX'],
      });
    }
    if (env.VERCEL_ENV === 'production' && env.CLOUDINARY_FOLDER_PREFIX
      && env.CLOUDINARY_FOLDER_PREFIX !== 'my-closet') {
      context.addIssue({
        code: 'custom',
        message: 'Production debe conservar la carpeta Cloudinary de producción',
        path: ['CLOUDINARY_FOLDER_PREFIX'],
      });
    }
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
    if (
      env.DATABASE_URL_UNPOOLED &&
      !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL_UNPOOLED)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL_UNPOOLED debe usar postgres:// o postgresql://',
        path: ['DATABASE_URL_UNPOOLED'],
      });
    }

    const bootstrapConfiguration = [
      env.BOOTSTRAP_ADMIN_EMAIL,
      env.BOOTSTRAP_ADMIN_PASSWORD,
    ];
    const bootstrapConfigurationCount = bootstrapConfiguration.filter(Boolean).length;
    if (
      bootstrapConfigurationCount > 0 &&
      bootstrapConfigurationCount < bootstrapConfiguration.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'El administrador bootstrap debe configurarse como un grupo completo',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
      });
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
    if (env.GOOGLE_AUTH_ENABLED && !appUrlIsValid) {
      context.addIssue({
        code: 'custom',
        message: 'GOOGLE_AUTH_ENABLED=true requiere NEXT_PUBLIC_APP_URL',
        path: ['NEXT_PUBLIC_APP_URL'],
      });
    }
  });

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

export const GOOGLE_AUTH_IMPLEMENTATION_READY = true;

export function isGoogleEnabled(env: ServerEnv = getEnv()): boolean {
  return Boolean(
    env.GOOGLE_AUTH_ENABLED &&
      GOOGLE_AUTH_IMPLEMENTATION_READY &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.NEXT_PUBLIC_APP_URL,
  );
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  appUrl: string;
  callbackUrl: string;
}

export function getGoogleAuthConfig(env: ServerEnv = getEnv()): GoogleAuthConfig | null {
  if (!isGoogleEnabled(env)) return null;
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  return {
    clientId,
    clientSecret,
    appUrl,
    callbackUrl: new URL('/api/auth/google/callback', appUrl).toString(),
  };
}

export function isPublicRegistrationEnabled(env: ServerEnv = getEnv()): boolean {
  return env.PUBLIC_REGISTRATION_ENABLED;
}

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Aísla nuevas escrituras; conserva las URLs de las imágenes históricas. */
export function getCloudinaryFolder(userId: string, env: ServerEnv = getEnv()): string {
  const prefix = env.CLOUDINARY_FOLDER_PREFIX
    ?? (env.VERCEL_ENV === 'preview' ? 'my-closet-preview' : 'my-closet');
  return `${prefix}/${userId}`;
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
