import { wardrobeInvitationResponseSchema, wardrobeInvitationTokenSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import { invalidBody, jsonError, jsonOk, requireSameOrigin, unauthorized } from '@/server/http';
import {
  acceptWardrobeInvitation,
  inspectWardrobeInvitation,
  WardrobeInvitationError,
} from '@/server/repositories/wardrobe-invitations-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

function invitationError(error: unknown): Response | null {
  if (!(error instanceof WardrobeInvitationError)) return null;
  if (error.code === 'EMAIL_MISMATCH') {
    return jsonError(403, 'Esta invitación pertenece a otro correo');
  }
  if (error.code === 'SELF_INVITATION') {
    return jsonError(409, 'No puedes aceptar tu propia invitación');
  }
  if (error.code === 'ALREADY_ACCEPTED') {
    return jsonError(409, 'La invitación ya fue aceptada por otra cuenta');
  }
  return jsonError(404, 'La invitación no existe o fue revocada');
}

async function readToken(context: Context): Promise<string | null> {
  const parsed = wardrobeInvitationTokenSchema.safeParse((await context.params).token);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const token = await readToken(context);
  if (!token) return invalidBody('Invitación de armario no válida');
  try {
    const invitation = await inspectWardrobeInvitation(token, principal);
    return jsonOk(wardrobeInvitationResponseSchema.parse(invitation));
  } catch (error) {
    const response = invitationError(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const principal = await getSessionUser();
  if (!principal) return unauthorized();
  const token = await readToken(context);
  if (!token) return invalidBody('Invitación de armario no válida');
  try {
    const invitation = await acceptWardrobeInvitation(token, principal);
    return jsonOk(wardrobeInvitationResponseSchema.parse(invitation));
  } catch (error) {
    const response = invitationError(error);
    if (response) return response;
    throw error;
  }
}
