import { describe, expect, it } from 'vitest';
import {
  getDatabaseDialect,
  isCloudinaryEnabled,
  isGoogleEnabled,
  parseServerEnv,
} from '@/server/env';
import {
  createServerDB,
  DatabaseProviderNotImplementedError,
} from '@/server/db';

describe('configuracion de proveedores externos', () => {
  it('usa solamente proveedores locales por defecto', () => {
    const env = parseServerEnv({});

    expect(env).toMatchObject({
      DATABASE_PROVIDER: 'sqlite',
      IMAGE_PROVIDER: 'local',
      GOOGLE_AUTH_ENABLED: false,
    });
    expect(getDatabaseDialect(env)).toBe('sqlite');
    expect(isCloudinaryEnabled(env)).toBe(false);
    expect(isGoogleEnabled(env)).toBe(false);
  });

  it.each([
    [{ CLOUDINARY_CLOUD_NAME: 'closet' }],
    [{ GOOGLE_CLIENT_ID: 'client-id' }],
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
    });

    expect(getDatabaseDialect(env)).toBe('sqlite');
    expect(isCloudinaryEnabled(env)).toBe(false);
    expect(isGoogleEnabled(env)).toBe(false);
  });

  it.each([
    [{ DATABASE_PROVIDER: 'postgres' }],
    [{ IMAGE_PROVIDER: 'cloudinary' }],
    [{ GOOGLE_AUTH_ENABLED: 'true' }],
  ])('rechaza proveedores habilitados sin credenciales: %o', (input) => {
    expect(() => parseServerEnv(input)).toThrow();
  });

  it('no anuncia Google mientras no exista la implementacion OAuth', () => {
    const env = parseServerEnv({
      GOOGLE_AUTH_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    expect(isGoogleEnabled(env)).toBe(false);
  });

  it('falla antes de conectar cuando PostgreSQL se activa explicitamente', async () => {
    const env = parseServerEnv({
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: 'postgresql://user:password@example.test/closet',
    });

    await expect(createServerDB(env)).rejects.toBeInstanceOf(
      DatabaseProviderNotImplementedError,
    );
  });
});
