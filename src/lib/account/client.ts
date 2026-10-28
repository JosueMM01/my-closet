import type { LocalProfile } from '@/lib/domain/types';
import {
  accountProfileSchema,
  emailChangeResponseSchema,
  emailChangeRequestedResponseSchema,
  emailChangeConfirmSchema,
  emailChangeSchema,
  operationSuccessResponseSchema,
  passwordChangeSchema,
  profileUpdateSchema,
} from '@/lib/domain/validation';
import { jsonBody, parseClientInput, requestJSON } from '@/lib/api/client';
import { setLocalProfile } from '@/lib/local/kv';

function toLocalProfile(profile: typeof accountProfileSchema._output): LocalProfile {
  return {
    userId: profile.userId,
    email: profile.email,
    displayName: profile.displayName,
    createdAt: profile.createdAt,
    role: profile.role,
    profileImageId: profile.profileImageId,
  };
}

async function persistProfile(profile: typeof accountProfileSchema._output): Promise<LocalProfile> {
  const local = toLocalProfile(profile);
  await setLocalProfile(local);
  return local;
}

export async function fetchProfile(): Promise<LocalProfile> {
  return persistProfile(await requestJSON('/api/profile', accountProfileSchema));
}

export async function updateProfile(input: {
  displayName?: string;
  profileImageId?: string | null;
}): Promise<LocalProfile> {
  const body = parseClientInput(profileUpdateSchema, input, 'Datos de perfil inválidos');
  const profile = await requestJSON('/api/profile', accountProfileSchema, {
    method: 'PATCH',
    ...jsonBody(body),
  });
  return persistProfile(profile);
}

export async function changePassword(input: {
  currentPassword: string;
}): Promise<void> {
  const body = parseClientInput(passwordChangeSchema, input, 'Datos de contraseña inválidos');
  await requestJSON('/api/profile/password', operationSuccessResponseSchema, {
    method: 'POST',
    ...jsonBody(body),
  });
}

export async function changeEmail(input: {
  currentPassword: string;
  newEmail: string;
}): Promise<typeof emailChangeRequestedResponseSchema._output> {
  const body = parseClientInput(emailChangeSchema, input, 'Datos de correo inválidos');
  return requestJSON('/api/profile/email', emailChangeRequestedResponseSchema, {
    method: 'POST',
    ...jsonBody(body),
  });
}

export async function confirmEmailChange(code: string): Promise<LocalProfile> {
  const body = parseClientInput(emailChangeConfirmSchema, { code }, 'El código debe tener 6 dígitos');
  await requestJSON('/api/profile/email/confirm', emailChangeResponseSchema, {
    method: 'POST', ...jsonBody(body),
  });
  return fetchProfile();
}
