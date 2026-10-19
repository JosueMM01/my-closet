import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGoogleInvitation } from '@/lib/auth/client';
afterEach(() => vi.unstubAllGlobals());
describe('inicio de invitación Google', () => {
  it('usa JSON sin redirecciones fetch y valida el destino antes de navegar', async () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=test';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorizationUrl: url })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startGoogleInvitation('t'.repeat(43))).resolves.toBe(url);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start', expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({ invitationToken: 't'.repeat(43) }),
    }));
  });
  it.each(['https://evil.example/', 'javascript:alert(1)', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth'])('rechaza %s', async url => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authorizationUrl: url }))));
    await expect(startGoogleInvitation('t'.repeat(43))).rejects.toThrow();
  });
  it('conserva el error de una invitación utilizada en vez de mostrar JSON crudo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invitación utilizada' }), { status: 410 })));
    await expect(startGoogleInvitation('t'.repeat(43))).rejects.toThrow('Invitación utilizada');
  });
});
