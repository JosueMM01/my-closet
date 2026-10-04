import { z } from 'zod';

export const googleFailureReasonSchema = z.enum([
  'denied', 'account-unavailable', 'cancelled', 'provider-error', 'session-invalid',
  'reauth-required', 'email-mismatch', 'account-mismatch', 'invitation-invalid',
  'invitation-expired', 'admin-limit', 'already-registered', 'already-linked',
]);
export type GoogleFailureReason = z.infer<typeof googleFailureReasonSchema>;

const messages: Record<GoogleFailureReason, string> = {
  denied: 'No se pudo verificar el acceso con Google. Inténtalo otra vez; si el problema continúa, contacta al responsable de la app.',
  'account-unavailable': 'No se encontró una cuenta activa vinculada a esta cuenta de Google. Si ya tienes cuenta, inicia sesión con contraseña y vincula Google desde Perfil; si no, necesitas una invitación.',
  cancelled: 'Cancelaste o no autorizaste el acceso con Google. Puedes intentarlo otra vez.',
  'provider-error': 'Google no pudo completar la autorización. Inténtalo nuevamente.',
  'session-invalid': 'La solicitud de acceso con Google ya no es válida. Inicia el proceso otra vez desde esta app.',
  'reauth-required': 'Tu sesión ya no es válida para completar esta acción. Inicia sesión nuevamente.',
  'email-mismatch': 'El correo verificado de Google no coincide con el correo de tu cuenta o invitación. Selecciona la cuenta correcta.',
  'account-mismatch': 'Selecciona la cuenta de Google que ya está vinculada a tu perfil.',
  'invitation-invalid': 'La invitación no es válida, ya fue utilizada o fue revocada. Solicita una nueva invitación.',
  'invitation-expired': 'La invitación ha caducado. Solicita una nueva invitación.',
  'admin-limit': 'Ya existen dos administradores activos. Pide al administrador una invitación como Usuario.',
  'already-registered': 'Ya existe una cuenta con el correo verificado de Google. Inicia sesión con tu cuenta existente y vincula Google desde Perfil.',
  'already-linked': 'Esta cuenta de Google ya está vinculada. Inicia sesión con la cuenta correspondiente o revisa la vinculación desde Perfil.',
};

/** Never display raw OAuth errors, email addresses, tokens or query-string content. */
export function googleFailureMessage(reason: unknown): string | null {
  if (reason === null || reason === undefined) return null;
  const parsed = googleFailureReasonSchema.safeParse(reason);
  return messages[parsed.success ? parsed.data : 'denied'];
}
