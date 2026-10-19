import { authProvidersResponseSchema } from '@/lib/domain/validation';
import { isGoogleEnabled, isPublicRegistrationEnabled } from '@/server/env';
import { jsonOk } from '@/server/http';
import { turnstileConfiguration } from '@/server/auth/turnstile';

export const runtime = 'nodejs';

/** Capacidades de login implementadas y habilitadas explicitamente. */
export async function GET() {
  const challenge = turnstileConfiguration();
  return jsonOk(
    authProvidersResponseSchema.parse({
      credentials: true,
      google: isGoogleEnabled(),
      publicRegistration: isPublicRegistrationEnabled(),
      invitationRegistration: true,
      turnstile: { enabled: challenge.enabled, siteKey: challenge.enabled ? challenge.config?.siteKey ?? null : null },
    }),
  );
}
