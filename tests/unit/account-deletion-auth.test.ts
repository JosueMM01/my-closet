import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deletionSessionBinding, freshGoogleDeletionAuthentication, readDeletionContext, signDeletionContext } from '@/server/auth/account-deletion';
import { isDeletionStorageKeyInScope } from '@/server/services/account-deletion-cleanup';
import { parseServerEnv } from '@/server/env';

const state = 'synthetic-oauth-state-of-at-least-32-bytes';
const session = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'isolated-account-deletion-auth-secret-32-bytes');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('reautenticación de baja', () => {
  it('mantiene desactivadas la baja y la limpieza remota por defecto', () => {
    expect(parseServerEnv({ NODE_ENV: 'test' })).toMatchObject({ ACCOUNT_DELETION_ENABLED: false, ACCOUNT_DELETION_REMOTE_CLEANUP_ENABLED: false });
    expect(parseServerEnv({ NODE_ENV: 'test', ACCOUNT_DELETION_ENABLED: 'false' }).ACCOUNT_DELETION_ENABLED).toBe(false);
  });
  it('liga el contexto firmado a sesión, usuario, estado y plazo', () => {
    const context = signDeletionContext('synthetic-user', state, session);
    expect(readDeletionContext(context, state, session)?.userId).toBe('synthetic-user');
    expect(readDeletionContext(context, 'otro-estado', session)).toBeNull();
    expect(readDeletionContext(context, state, `${session}changed`)).toBeNull();
    expect(readDeletionContext(`${context}changed`, state, session)).toBeNull();
    vi.advanceTimersByTime(600_001);
    expect(readDeletionContext(context, state, session)).toBeNull();
  });
  it('no acepta iat reciente como sustituto de auth_time ni fechas antiguas/futuras', () => {
    const now = Date.now();
    expect(freshGoogleDeletionAuthentication(undefined, now)).toBe(false);
    expect(freshGoogleDeletionAuthentication(now / 1000 - 3600, now)).toBe(false);
    expect(freshGoogleDeletionAuthentication(now / 1000 + 120, now)).toBe(false);
    expect(freshGoogleDeletionAuthentication(now / 1000, now)).toBe(true);
  });
  it('no expone el token de sesión en el enlace de contexto', () => {
    const context = signDeletionContext('synthetic-user', state, session);
    const payload = Buffer.from(context.split('.')[0]!, 'base64url').toString();
    expect(payload).not.toContain(session);
    expect(deletionSessionBinding(session).sessionHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('aislamiento de limpieza de imágenes', () => {
  it.each([null, 'production/image', 'isolated/../production/image', 'isolated//image', 'isolated/./image', 'isolated/image\n'])('rechaza claves fuera de alcance o ambiguas: %s', key => {
    expect(isDeletionStorageKeyInScope(key, 'isolated')).toBe(false);
  });
  it('exige un prefijo explícito y completo', () => {
    expect(isDeletionStorageKeyInScope('isolated/image', undefined)).toBe(false);
    expect(isDeletionStorageKeyInScope('isolated-other/image', 'isolated')).toBe(false);
    expect(isDeletionStorageKeyInScope('isolated/image', 'isolated')).toBe(true);
  });
});
