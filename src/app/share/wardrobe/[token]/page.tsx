import Link from 'next/link';
import { wardrobeInvitationTokenSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/server/auth/session';
import {
  inspectWardrobeInvitation,
  WardrobeInvitationError,
} from '@/server/repositories/wardrobe-invitations-repository';
import { AcceptWardrobeInvitationButton } from './accept-button';

export const dynamic = 'force-dynamic';

export default async function WardrobeInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const parsed = wardrobeInvitationTokenSchema.safeParse((await params).token);
  const token = parsed.success ? parsed.data.toLowerCase() : null;
  const principal = await getSessionUser();
  const returnPath = token ? `/share/wardrobe/${token}` : '/';

  let content;
  if (!token) {
    content = <p role="alert" className="text-sm font-medium text-danger">La invitación no es válida.</p>;
  } else if (!principal) {
    content = (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Inicia sesión con el correo que recibió esta invitación para continuar.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(returnPath)}`}
          className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 font-semibold text-white"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  } else {
    let invitation: Awaited<ReturnType<typeof inspectWardrobeInvitation>> | null = null;
    let invitationError: string | null = null;
    try {
      invitation = await inspectWardrobeInvitation(token, principal);
    } catch (error) {
      invitationError = error instanceof WardrobeInvitationError && error.code === 'EMAIL_MISMATCH'
        ? 'Esta invitación pertenece a otro correo.'
        : error instanceof WardrobeInvitationError && error.code === 'SELF_INVITATION'
          ? 'No puedes aceptar tu propia invitación.'
          : 'La invitación no existe, fue revocada o ya no está disponible.';
    }
    if (invitationError || !invitation) {
      content = (
        <p role="alert" className="text-sm font-medium text-danger">
          {invitationError ?? 'No se pudo consultar la invitación.'}
        </p>
      );
    } else {
      content = invitation.accepted ? (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Esta invitación ya fue aceptada por tu cuenta.</p>
          <Link href="/" className="font-semibold text-primary">Ir a My Closet</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Recibirás permiso para {invitation.permission === 'MANAGE' ? 'ver y gestionar' : 'ver'} este armario.
          </p>
          <AcceptWardrobeInvitationButton token={token} />
        </div>
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-5 py-10">
      <section className="card-surface w-full space-y-5 p-6 text-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">My Closet</p>
          <h1 className="mt-2 font-heading text-2xl">Invitación de armario</h1>
        </div>
        {content}
      </section>
    </main>
  );
}
