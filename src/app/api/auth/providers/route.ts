import { isGoogleEnabled } from '@/server/env';
import { jsonOk } from '@/server/http';

export const runtime = 'nodejs';

/** Capacidades de login implementadas y habilitadas explicitamente. */
export async function GET() {
  return jsonOk({
    credentials: true,
    google: isGoogleEnabled(),
  });
}
