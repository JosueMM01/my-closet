/**
 * Cliente de autenticación del navegador.
 * Los tokens viven únicamente en cookies HttpOnly gestionadas por el
 * servidor; aquí solo se persiste el perfil local (sin secretos).
 */
import type { LocalProfile } from '@/lib/domain/types';
import { setLocalProfile, clearLocalProfile } from '@/lib/local/kv';
import { maybeSync } from '@/lib/local/sync-engine';

interface AuthResponse {
  profile: {
    userId: string;
    email: string;
    displayName: string;
    createdAt?: string;
  };
}

async function postJSON(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' },
    body: JSON.stringify(body),
  });
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function handleAuthResponse(response: Response): Promise<LocalProfile> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AuthError(data?.error ?? 'Error de autenticación', response.status);
  }
  const data = (await response.json()) as AuthResponse;
  const profile: LocalProfile = {
    userId: data.profile.userId,
    email: data.profile.email,
    displayName: data.profile.displayName,
    createdAt: data.profile.createdAt ?? new Date().toISOString(),
  };
  await setLocalProfile(profile);
  // Sincroniza (pull inicial) cuando haya conexión; si no, quedará pendiente.
  void maybeSync();
  return profile;
}

export async function register(input: {
  displayName: string;
  email: string;
  password: string;
}): Promise<LocalProfile> {
  const response = await postJSON('/api/auth/register', input);
  return handleAuthResponse(response);
}

export async function login(input: { email: string; password: string }): Promise<LocalProfile> {
  const response = await postJSON('/api/auth/login', input);
  return handleAuthResponse(response);
}

export async function logout(): Promise<void> {
  await postJSON('/api/auth/logout', {}).catch(() => undefined);
  // Los datos locales y la outbox se conservan (regla offline-first).
  await clearLocalProfile();
}

export interface RemoteSessionState {
  checking: boolean;
  authenticated: boolean | null;
  googleEnabled: boolean;
}

/** Consulta la sesión remota (cookie) y los proveedores disponibles. */
export async function fetchRemoteSession(): Promise<{
  authenticated: boolean;
  googleEnabled: boolean;
}> {
  const [sessionRes, providersRes] = await Promise.all([
    fetch('/api/auth/session', { headers: { 'x-requested-with': 'my-closet' } }),
    fetch('/api/auth/providers'),
  ]);
  if (!sessionRes.ok || !providersRes.ok) {
    return { authenticated: false, googleEnabled: false };
  }
  const session = (await sessionRes.json()) as { authenticated: boolean };
  const providers = (await providersRes.json()) as { google: boolean };
  return { authenticated: session.authenticated, googleEnabled: providers.google };
}
