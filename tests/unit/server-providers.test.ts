import { describe, expect, it } from 'vitest';
import {
  getDatabaseDialect,
  isCloudinaryEnabled,
  isGoogleEnabled,
  parseServerEnv,
} from '@/server/env';

describe('configuracion de proveedores externos', () => {
  it('usa solamente proveedores locales por defecto', () => {
    const env = parseServerEnv({});

    expect(env).toMatchObject({
      DATABASE_PROVIDER: 'sqlite',
      IMAGE_PROVIDER: 'local',
      GOOGLE_AUTH_ENABLED: false,
      EMAIL_PROVIDER: 'disabled',
      PUBLIC_REGISTRATION_ENABLED: false,
    });
    expect(getDatabaseDialect(env)).toBe('sqlite');
    expect(isCloudinaryEnabled(env)).toBe(false);
    expect(isGoogleEnabled(env)).toBe(false);
  });

  it('deshabilita el registro público por defecto en todos los entornos', () => {
    expect(parseServerEnv({ NODE_ENV: 'development' }).PUBLIC_REGISTRATION_ENABLED).toBe(false);
    expect(parseServerEnv({ NODE_ENV: 'test' }).PUBLIC_REGISTRATION_ENABLED).toBe(false);
    expect(parseServerEnv({ NODE_ENV: 'production' }).PUBLIC_REGISTRATION_ENABLED).toBe(false);
    expect(
      parseServerEnv({
        NODE_ENV: 'production',
        PUBLIC_REGISTRATION_ENABLED: 'true',
      }).PUBLIC_REGISTRATION_ENABLED,
    ).toBe(true);
    expect(() => parseServerEnv({ PUBLIC_REGISTRATION_ENABLED: 'yes' })).toThrow();
  });

  it.each([
    [{ CLOUDINARY_CLOUD_NAME: 'closet' }],
    [{ GOOGLE_CLIENT_ID: 'client-id' }],
    [{ BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test' }],
    [{ BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-test-password' }],
  ])('rechaza grupos de credenciales parciales: %o', (input) => {
    expect(() => parseServerEnv(input)).toThrow();
  });

  it('no activa proveedores externos solo por encontrar credenciales', () => {
    const env = parseServerEnv({
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'postgresql://user:password@example.test/closet',
      IMAGE_PROVIDER: 'local',
      CLOUDINARY_CLOUD_NAME: 'closet',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
      GOOGLE_AUTH_ENABLED: 'false',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      EMAIL_FROM: 'My Closet <mail@example.test>',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer@example.test',
      SMTP_PASSWORD: 'app-password',
    });

    expect(getDatabaseDialect(env)).toBe('sqlite');
    expect(isCloudinaryEnabled(env)).toBe(false);
    expect(isGoogleEnabled(env)).toBe(false);
    expect(env.EMAIL_PROVIDER).toBe('disabled');
  });

  it.each([
    [{ SMTP_USER: 'mailer@example.test' }],
    [
      {
        EMAIL_FROM: 'mail@example.test',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '465.5',
        SMTP_SECURE: 'true',
        SMTP_USER: 'mailer@example.test',
        SMTP_PASSWORD: 'app-password',
      },
    ],
    [
      {
        EMAIL_FROM: 'mail@example.test\r\nBcc: victim@example.test',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'mailer@example.test',
        SMTP_PASSWORD: 'app-password',
      },
    ],
  ])('rechaza configuración SMTP parcial, no entera o insegura: %o', (input) => {
    expect(() => parseServerEnv(input)).toThrow();
  });

  it('acepta Gmail con App Password sin activarlo implícitamente', () => {
    const env = parseServerEnv({
      EMAIL_FROM: 'My Closet <closet@gmail.com>',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'closet@gmail.com',
      SMTP_PASSWORD: 'app-password',
    });

    expect(env).toMatchObject({
      EMAIL_PROVIDER: 'disabled',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
    });
  });

  it('exige URL pública HTTP(S) al activar SMTP', () => {
    const smtp = {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'mail@example.test',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer@example.test',
      SMTP_PASSWORD: 'app-password',
      NODE_ENV: 'production',
    } as const;

    expect(() => parseServerEnv(smtp)).toThrow();
    expect(() => parseServerEnv({ ...smtp, NEXT_PUBLIC_APP_URL: 'ftp://example.test' })).toThrow();
    expect(
      parseServerEnv({ ...smtp, NEXT_PUBLIC_APP_URL: 'https://closet.example.test' })
        .EMAIL_PROVIDER,
    ).toBe('smtp');
  });

  it.each([
    [{ DATABASE_PROVIDER: 'postgres' }],
    [{ IMAGE_PROVIDER: 'cloudinary' }],
    [{ GOOGLE_AUTH_ENABLED: 'true' }],
  ])('rechaza proveedores habilitados sin credenciales: %o', (input) => {
    expect(() => parseServerEnv(input)).toThrow();
  });

  it('anuncia Google solo con activación, credenciales y URL completas', () => {
    const env = parseServerEnv({
      GOOGLE_AUTH_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      NEXT_PUBLIC_APP_URL: 'https://closet.example.test',
    });

    expect(isGoogleEnabled(env)).toBe(true);
  });

  it('activa PostgreSQL solamente con una URL explicita', () => {
    const env = parseServerEnv({
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: 'postgresql://user:password@example.test/closet',
    });

    expect(getDatabaseDialect(env)).toBe('postgres');
  });
});
