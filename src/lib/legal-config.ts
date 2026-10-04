import { z } from 'zod';

const optionalPublicText = z.preprocess(
  (value) => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().trim().min(2).max(160).optional(),
);
const optionalPublicEmail = z.preprocess(
  (value) => typeof value === 'string' && !value.trim() ? undefined : value,
  z.email().max(254).optional(),
);

export const legalContactSchema = z.object({
  operatorName: optionalPublicText,
  contactEmail: optionalPublicEmail,
});

/** Only deliberately public fields; never falls back to administrator or SMTP credentials. */
export function parseLegalContact(input: unknown) {
  const result = legalContactSchema.safeParse(input);
  if (!result.success) {
    // Do not include configuration values in build logs.
    throw new Error('Configuración legal pública inválida: revisa PUBLIC_LEGAL_OPERATOR_NAME y PUBLIC_LEGAL_CONTACT_EMAIL.');
  }
  return {
    ...result.data,
    ready: Boolean(result.data.operatorName && result.data.contactEmail),
  };
}

export const LEGAL_REVISED_ON = '4 de octubre de 2026';
