import { authProvidersResponseSchema } from '@/lib/domain/validation';
import { isGoogleEnabled, isPublicRegistrationEnabled } from '@/server/env';
import { jsonOk } from '@/server/http';

export const runtime = 'nodejs';

/** Capacidades de login implementadas y habilitadas explicitamente. */
export async function GET() {
  return jsonOk(
    authProvidersResponseSchema.parse({
      credentials: true,
      google: isGoogleEnabled(),
      publicRegistration: isPublicRegistrationEnabled(),
      invitationRegistration: true,
    }),
  );
}
