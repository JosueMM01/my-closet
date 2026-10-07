/**
 * Cliente de autenticación del navegador.
 * Los tokens viven únicamente en cookies HttpOnly gestionadas por el
 * servidor; aquí solo se persiste el perfil local (sin secretos).
 */
import type { LocalProfile } from '@/lib/domain/types';
import {
  authProvidersResponseSchema,
  authResponseSchema,
  apiErrorResponseSchema,
  operationSuccessResponseSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionResponseSchema,
} from '@/lib/domain/validation';
import { setLocalProfile, clearLocalProfile } from '@/lib/local/kv';
import { maybeSync } from '@/lib/local/sync-engine';

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

async function handleAuthResponse(response: Response, expectedUserId?: string): Promise<LocalProfile> {
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new AuthError(
      parsed.success ? parsed.data.error : 'Error de autenticación',
      response.status,
    );
  }
  const data = authResponseSchema.parse(await response.json());
  if (expectedUserId && data.profile.userId !== expectedUserId) {
    // La nueva cookie no debe quedar activa para otra cuenta durante recuperación.
    await endRemoteSession().catch(() => undefined);
    throw new AuthError('Inicia sesión con la misma cuenta de este dispositivo. Tus datos locales se conservaron.', 409);
  }
  const profile: LocalProfile = {
    userId: data.profile.userId,
    email: data.profile.email,
    displayName: data.profile.displayName,
    createdAt: data.profile.createdAt,
    role: data.profile.role,
    profileImageId: data.profile.profileImageId,
  };
  await setLocalProfile(profile);
  // Sincroniza (pull inicial) cuando haya conexión; si no, quedará pendiente.
  void maybeSync();
  return profile;
}

export async function register(input: {
  displayName: string;
  password: string;
  email?: string;
  invitationToken?: string;
}): Promise<LocalProfile> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? 'Datos de registro inválidos', 400);
  }
  const response = await postJSON('/api/auth/register', parsed.data);
  return handleAuthResponse(response);
}

export async function login(input: { email: string; password: string }, expectedUserId?: string): Promise<LocalProfile> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? 'Datos de acceso inválidos', 400);
  }
  const response = await postJSON('/api/auth/login', parsed.data);
  return handleAuthResponse(response, expectedUserId);
}

/** Revoca únicamente la sesión remota. No toca perfil, imágenes ni outbox local. */
export async function endRemoteSession(): Promise<void> {
  const response = await postJSON('/api/auth/logout', {});
  if (!response.ok) throw new AuthError('No se pudo cerrar la sesión remota. Vuelve a intentarlo con conexión.', response.status);
  operationSuccessResponseSchema.parse(await response.json());
}

export async function requestPasswordRecovery(email: string): Promise<void> {
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? 'Correo inválido', 400);
  }
  const response = await postJSON('/api/auth/forgot-password', parsed.data);
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new AuthError(error.success ? error.data.error : 'No se pudo procesar la solicitud', response.status);
  }
  operationSuccessResponseSchema.parse(await response.json());
}

export async function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? 'Datos de recuperación inválidos', 400);
  }
  const response = await postJSON('/api/auth/reset-password', parsed.data);
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new AuthError(error.success ? error.data.error : 'No se pudo cambiar la contraseña', response.status);
  }
  operationSuccessResponseSchema.parse(await response.json());
}

export async function logout(options?: { requireRemote?: boolean }): Promise<void> {
  if (options?.requireRemote) await endRemoteSession();
  else await endRemoteSession().catch(() => undefined);
  // Los datos locales y la outbox se conservan (regla offline-first).
  await clearLocalProfile();
}

export interface RemoteSessionState {
  checking: boolean;
  authenticated: boolean | null;
  googleEnabled: boolean;
  publicRegistrationEnabled: boolean;
}

/** Consulta la sesión remota (cookie) y los proveedores disponibles. */
export async function fetchRemoteSession(): Promise<{
  authenticated: boolean;
  googleEnabled: boolean;
  publicRegistrationEnabled: boolean;
}> {
  const [sessionRes, providersRes] = await Promise.all([
    fetch('/api/auth/session', { headers: { 'x-requested-with': 'my-closet' } }),
    fetch('/api/auth/providers'),
  ]);
  if (!sessionRes.ok || !providersRes.ok) {
    return {
      authenticated: false,
      googleEnabled: false,
      publicRegistrationEnabled: false,
    };
  }
  const session = sessionResponseSchema.parse(await sessionRes.json());
  const providers = authProvidersResponseSchema.parse(await providersRes.json());
  return {
    authenticated: session.authenticated,
    googleEnabled: providers.google,
    publicRegistrationEnabled: providers.publicRegistration,
  };
}

export async function fetchAuthProviders() {
  const response = await fetch('/api/auth/providers');
  if (!response.ok) throw new AuthError('No se pudo consultar el registro disponible', response.status);
  const parsed = authProvidersResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AuthError('Respuesta de acceso inesperada', response.status);
  return parsed.data;
}
