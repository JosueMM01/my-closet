import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endRemoteSession, login, logout } from '@/lib/auth/client';
import { clearLocalProfile, setLocalProfile } from '@/lib/local/kv';
import { maybeSync } from '@/lib/local/sync-engine';

vi.mock('@/lib/local/kv', () => ({ setLocalProfile: vi.fn(), clearLocalProfile: vi.fn() }));
vi.mock('@/lib/local/sync-engine', () => ({ maybeSync: vi.fn() }));

const owner = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const input = { email: 'fixture@example.test', password: 'synthetic-password' };
const authResponse = (userId: string) => Response.json({ profile: {
  userId, email: input.email, displayName: 'Cuenta de prueba',
  createdAt: '2026-10-04T00:00:00.000Z', role: 'USER', status: 'ACTIVE', profileImageId: null,
} });

describe('recuperación de sesión sin cambio silencioso de cuenta', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('recupera la misma cuenta y reanuda sync', async () => {
    fetchMock.mockResolvedValueOnce(authResponse(owner));
    expect((await login(input, owner)).userId).toBe(owner);
    expect(setLocalProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: owner }));
    expect(maybeSync).toHaveBeenCalledOnce();
    expect(clearLocalProfile).not.toHaveBeenCalled();
  });

  it('rechaza otra identidad antes de escribir IndexedDB o sincronizar y revoca cookie', async () => {
    fetchMock.mockResolvedValueOnce(authResponse(other)).mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(login(input, owner)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(setLocalProfile).not.toHaveBeenCalled();
    expect(clearLocalProfile).not.toHaveBeenCalled();
    expect(maybeSync).not.toHaveBeenCalled();
  });

  it('incluso si falla la revocación conserva los datos de la cuenta local', async () => {
    fetchMock.mockResolvedValueOnce(authResponse(other)).mockRejectedValueOnce(new TypeError('offline'));
    await expect(login(input, owner)).rejects.toMatchObject({ status: 409 });
    expect(setLocalProfile).not.toHaveBeenCalled();
    expect(maybeSync).not.toHaveBeenCalled();
  });

  it('preparar reautenticación revoca sin borrar el perfil ni disparar sync', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await endRemoteSession();
    expect(clearLocalProfile).not.toHaveBeenCalled();
    expect(setLocalProfile).not.toHaveBeenCalled();
    expect(maybeSync).not.toHaveBeenCalled();
  });

  it('no anuncia logout correcto si el servidor falla', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }));
    await expect(endRemoteSession()).rejects.toMatchObject({ status: 503 });
    expect(clearLocalProfile).not.toHaveBeenCalled();
  });

  it('cambio explícito por invitación no borra el perfil si logout remoto falla', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(logout({ requireRemote: true })).rejects.toThrow('offline');
    expect(clearLocalProfile).not.toHaveBeenCalled();
  });

  it('logout normal mantiene soporte offline mientras el cambio de cuenta exige revocación', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await logout();
    expect(clearLocalProfile).toHaveBeenCalledOnce();
  });
});
