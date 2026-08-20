'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LocalProfile, UserRole, UserStatus } from '@/lib/domain/types';
import { ApiClientError } from '@/lib/api/client';
import {
  createAdminInvitation,
  refreshAdminInvitations,
  refreshAdminUsers,
  revokeAdminInvitation,
  updateAdminUser,
} from '@/lib/admin/client';
import { getDB } from '@/lib/local/db';
import { useSync } from '@/components/providers';
import { Button, Field, Select, TextInput } from './ui';

function readableError(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : 'No se pudo completar la acción de administración';
}

export function ProfileAdmin({ profile }: { profile: LocalProfile }) {
  const { online } = useSync();
  const users = useLiveQuery(() => getDB().adminUsers.orderBy('createdAt').toArray(), []) ?? [];
  const invitations = useLiveQuery(
    () => getDB().adminInvitations.orderBy('createdAt').reverse().toArray(),
    [],
  ) ?? [];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [busy, setBusy] = useState<string | null>(online ? 'refresh' : null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    let active = true;
    void Promise.all([refreshAdminUsers(), refreshAdminInvitations()])
      .catch((caught) => {
        if (active) setError(readableError(caught));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [online]);

  const [mountedAt] = useState(() => Date.now());
  const pendingInvitations = invitations.filter(
    (invitation) =>
      !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > mountedAt,
  );
  const activeAdminCount = users.filter(
    (user) => user.role === 'ADMIN' && user.status === 'ACTIVE',
  ).length;

  async function createInvitation(event: React.FormEvent) {
    event.preventDefault();
    if (!online || busy) return;
    setBusy('create-invitation');
    setError(null);
    setStatus(null);
    setInviteUrl(null);
    try {
      const created = await createAdminInvitation({
        email,
        role,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      setInviteUrl(created.inviteUrl);
      setEmail('');
      const delivery = created.delivery === 'sent'
        ? 'enviada por correo'
        : created.delivery === 'captured'
          ? 'capturada para pruebas'
          : 'creada; el correo está desactivado';
      setStatus(`Invitación ${delivery}. Caduca en 7 días.`);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function refreshReadModels() {
    if (!online || busy) return;
    setBusy('refresh');
    setError(null);
    try {
      await Promise.all([refreshAdminUsers(), refreshAdminInvitations()]);
      setStatus('Datos de administración actualizados.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setStatus('Enlace de invitación copiado.');
    } catch {
      setError('No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.');
    }
  }

  async function revoke(id: string) {
    if (!online || busy) return;
    setBusy(`invite-${id}`);
    setError(null);
    try {
      await revokeAdminInvitation(id);
      setStatus('Invitación revocada.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function changeUser(id: string, patch: { role?: UserRole; status?: UserStatus }) {
    if (!online || busy) return;
    setBusy(`user-${id}`);
    setError(null);
    setStatus(null);
    try {
      await updateAdminUser(id, patch);
      setStatus('Cuenta actualizada.');
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card-surface overflow-hidden" aria-labelledby="admin-title" data-testid="admin-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-primary-soft px-5 py-4 sm:px-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Administración</p>
          <h2 id="admin-title" className="mt-1 font-heading text-xl">Personas e invitaciones</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Puede haber como máximo dos administradores activos. El servidor confirma cada cambio.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={refreshReadModels}
          loading={busy === 'refresh'}
          disabled={!online || busy !== null}
        >
          Actualizar datos
        </Button>
      </div>

      {!online ? (
        <p className="border-b border-border bg-surface-alt px-5 py-3 text-sm text-warning sm:px-6" role="status">
          Sin conexión: puedes consultar la caché, pero las acciones administrativas están desactivadas.
        </p>
      ) : null}

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
        <div>
          <h3 className="font-heading text-base">Crear invitación</h3>
          <form onSubmit={createInvitation} className="mt-3 space-y-3" noValidate>
            <Field label="Correo de la persona invitada">
              <TextInput
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={!online || busy !== null}
              />
            </Field>
            <Field label="Rol inicial" hint="USER es la opción recomendada.">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                disabled={!online || busy !== null}
              >
                <option value="USER">Usuario</option>
                <option value="ADMIN">Administrador</option>
              </Select>
            </Field>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              loading={busy === 'create-invitation'}
              disabled={!online || busy !== null}
            >
              Crear invitación de 7 días
            </Button>
          </form>

          {inviteUrl ? (
            <div className="mt-4 rounded-xl border border-border bg-surface-alt p-3">
              <label htmlFor="created-invite-url" className="text-xs font-semibold text-text-secondary">
                Enlace listo para compartir
              </label>
              <input
                id="created-invite-url"
                readOnly
                value={inviteUrl}
                className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full"
                onClick={copyInviteUrl}
                disabled={!online || busy !== null}
              >
                Copiar enlace
              </Button>
            </div>
          ) : null}

          <div className="mt-6">
            <h3 className="font-heading text-base">Invitaciones pendientes</h3>
            {pendingInvitations.length === 0 ? (
              <p className="mt-2 rounded-xl bg-surface-alt p-3 text-sm text-text-secondary">
                No hay invitaciones pendientes.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {pendingInvitations.map((invitation) => (
                  <li key={invitation.id} className="rounded-xl border border-border p-3">
                    <p className="break-all text-sm font-semibold">{invitation.email}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {invitation.role === 'ADMIN' ? 'Administrador' : 'Usuario'} · caduca el{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString('es-ES')}
                    </p>
                    <Button
                      type="button"
                      variant="danger"
                      className="mt-2"
                      onClick={() => revoke(invitation.id)}
                      loading={busy === `invite-${invitation.id}`}
                      disabled={!online || busy !== null}
                    >
                      Revocar invitación
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-heading text-base">Cuentas</h3>
            <span className="text-xs font-semibold text-text-secondary">
              {activeAdminCount}/2 admins activos
            </span>
          </div>
          {busy === 'refresh' && users.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary" role="status">Actualizando cuentas…</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {users.map((user) => {
                const self = user.userId === profile.userId;
                const userBusy = busy === `user-${user.userId}`;
                return (
                  <li key={user.userId} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {user.displayName}{self ? ' (tú)' : ''}
                        </p>
                        <p className="truncate text-xs text-text-secondary">{user.email}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                        user.status === 'ACTIVE'
                          ? 'bg-primary-soft text-primary'
                          : 'bg-surface-alt text-text-secondary'
                      }`}>
                        {user.role === 'ADMIN' ? 'ADMIN' : 'USER'} · {user.status === 'ACTIVE' ? 'ACTIVA' : 'DESACTIVADA'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => changeUser(user.userId, { role: user.role === 'ADMIN' ? 'USER' : 'ADMIN' })}
                        disabled={!online || busy !== null || userBusy || self}
                      >
                        {user.role === 'ADMIN' ? 'Quitar admin' : 'Hacer admin'}
                      </Button>
                      <Button
                        type="button"
                        variant={user.status === 'ACTIVE' ? 'danger' : 'secondary'}
                        onClick={() => changeUser(user.userId, {
                          status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                        })}
                        disabled={!online || busy !== null || userBusy || self}
                      >
                        {user.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 sm:px-6" aria-live="polite">
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        {status ? <p className="text-sm font-medium text-success">{status}</p> : null}
      </div>
    </section>
  );
}
