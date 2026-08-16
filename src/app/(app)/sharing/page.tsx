'use client';

/**
 * Sharing del armario completo: invitaciones con permiso VIEW o MANAGE.
 * Diseñado para funcionar con pocos usuarios; el grantee acepta luego
 * el enlace con token. Los cambios se sincronizan como cualquier entidad.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import {
  createWardrobeShare,
  deleteWardrobeShare,
  updateWardrobeShare,
} from '@/lib/local/repositories';
import { permissionSchema, wardrobeShareInputSchema } from '@/lib/domain/validation';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, Chip, Field, TextInput } from '@/components/ui';
import { EyeIcon, PencilIcon, ShareIcon, TrashIcon } from '@/components/icons';

export default function SharingPage() {
  const { profile } = useSession();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'VIEW' | 'MANAGE'>('VIEW');
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const shares = useLiveQuery(
    async () =>
      profile
        ? (await getDB().wardrobeShares.where('grantorId').equals(profile.userId).toArray()).filter(
            (s) => !s.deletedAt,
          )
        : [],
    [profile?.userId],
  );

  if (!profile) return null;

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInviteUrl(null);
    if (!profile) return;
    const parsed = z.object({ email: z.email('Correo inválido') }).safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Correo inválido');
      return;
    }
    permissionSchema.parse(permission);
    wardrobeShareInputSchema.parse({ granteeEmail: parsed.data.email, permission });

    const share = await createWardrobeShare(profile.userId, parsed.data.email, permission);
    const url = `${window.location.origin}/share/wardrobe/${share.inviteToken}`;
    setInviteUrl(url);
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setEmail('');
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-heading text-2xl">Compartir armario</h1>

      <section className="card-surface p-5">
        <h2 className="mb-1 font-heading text-base">Nueva invitación</h2>
        <p className="mb-4 text-sm text-text-secondary">
          Genera un enlace para dar acceso a tu armario completo. Quien lo acepte podrá{' '}
          {permission === 'VIEW' ? 'ver' : 'ver y gestionar'} tus prendas y outfits.
        </p>
        <form onSubmit={handleInvite} className="space-y-4" noValidate>
          <Field label="Correo de la persona">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@correo.com"
            />
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">Permiso</p>
            <div className="flex gap-2">
              <Chip active={permission === 'VIEW'} onClick={() => setPermission('VIEW')}>
                <EyeIcon size={15} />
                Solo ver
              </Chip>
              <Chip active={permission === 'MANAGE'} onClick={() => setPermission('MANAGE')}>
                <PencilIcon size={15} />
                Gestionar
              </Chip>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" data-testid="create-invite">
            <ShareIcon size={16} />
            Crear invitación
          </Button>
        </form>

        {inviteUrl && (
          <div className="mt-4 rounded-xl bg-primary-soft p-3 text-xs text-primary" data-testid="invite-url" role="status">
            Enlace copiado: {inviteUrl}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-base">Invitaciones activas</h2>
        {shares === undefined ? (
          <div className="card-surface h-20 animate-pulse" />
        ) : shares.length === 0 ? (
          <div className="card-surface p-5 text-sm text-text-secondary">
            Todavía no has compartido tu armario con nadie.
          </div>
        ) : (
          shares.map((share) => (
            <div key={share.id} className="card-surface flex items-center gap-3 p-4" data-testid="share-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {share.granteeEmail ?? 'Invitación abierta'}
                </p>
                <p className="text-xs text-text-secondary">
                  {share.permission === 'VIEW' ? 'Solo ver' : 'Gestionar'} ·{' '}
                  {share.acceptedAt ? 'Aceptada' : 'Pendiente de aceptar'}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void updateWardrobeShare(share.id, {
                    permission: share.permission === 'VIEW' ? 'MANAGE' : 'VIEW',
                  })
                }
                aria-label="Cambiar permiso"
                title={share.permission === 'VIEW' ? 'Subir a Gestionar' : 'Bajar a Solo ver'}
                className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
              >
                {share.permission === 'VIEW' ? <PencilIcon size={18} /> : <EyeIcon size={18} />}
              </button>
              <button
                type="button"
                onClick={() => setToDelete(share.id)}
                aria-label="Revocar acceso"
                className="flex h-10 w-10 items-center justify-center rounded-full text-danger hover:bg-danger/10"
              >
                <TrashIcon size={18} />
              </button>
            </div>
          ))
        )}
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        title="¿Revocar acceso?"
        message="La persona dejará de tener acceso a tu armario. Puedes crear una nueva invitación cuando quieras."
        confirmLabel="Revocar"
        onConfirm={() => toDelete && void deleteWardrobeShare(toDelete)}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
