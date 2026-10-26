'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiClientError, jsonBody, requestJSON } from '@/lib/api/client';
import { accountDeletionInputSchema, accountDeletionResponseSchema, accountDeletionStatusSchema } from '@/lib/domain/validation';
import { markAccountDeleted } from '@/lib/local/kv';
import { Button, Field, PasswordInput } from './ui';

type DeletionStatus = ReturnType<typeof accountDeletionStatusSchema.parse>;

export function ProfileAccountDeletion({ userId, online, remoteExpired }: {
  userId: string; online: boolean; remoteExpired: boolean;
}) {
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!online || remoteExpired) return;
    let cancelled = false;
    void requestJSON('/api/profile/deletion', accountDeletionStatusSchema).then(value => {
      if (cancelled) return;
      setStatus(value);
      if (value.enabled && window.location.hash === '#delete-account') setOpen(true);
    }).catch(() => { /* Optional feature stays hidden when unavailable. */ });
    return () => { cancelled = true; };
  }, [online, remoteExpired, userId]);

  if (!status?.enabled) return null;
  return (
    <section id="delete-account" className="card-surface border border-danger/20 p-5">
      <h2 className="font-heading text-base">Eliminar tu cuenta</h2>
      <p className="mt-2 text-sm text-text-secondary">
        Una decisión definitiva. Revisa qué se elimina antes de confirmar tu identidad.
      </p>
      <Button variant="danger" className="mt-4" disabled={!online || remoteExpired} onClick={() => setOpen(true)}>
        Revisar eliminación
      </Button>
      {open ? <DeletionDialog userId={userId} status={status} online={online && !remoteExpired} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function DeletionDialog({ userId, status, online, onClose }: {
  userId: string; status: DeletionStatus; online: boolean; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [password, setPassword] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);
  const close = () => {
    if (busy || deleted) return;
    dialogRef.current?.close();
    onClose();
  };

  const leaveDeletedAccount = async () => {
    // Navigate before purging: unloading terminates in-flight sync/upload callbacks.
    // getLocalProfile purges this account transactionally before the next app starts.
    await markAccountDeleted(userId);
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('my-closet-account');
      channel.postMessage({ type: 'account-deleted', userId });
      channel.close();
    }
    window.location.replace('/login?account=deleted');
  };
  const confirm = async () => {
    if (busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      if (!deleted) {
        const input = accountDeletionInputSchema.parse({ acknowledge, ...(password ? { currentPassword: password } : {}) });
        await requestJSON('/api/profile/deletion', accountDeletionResponseSchema, { method: 'DELETE', ...jsonBody(input) });
        setDeleted(true);
        setPassword('');
      }
      await leaveDeletedAccount();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'No se pudo completar la limpieza de este dispositivo. Reintenta.');
      setBusy(false);
    }
  };
  const canConfirm = online && !busy && (deleted || (acknowledge && (password.length > 0 || status.reauthenticated)));
  return (
    <dialog ref={dialogRef} aria-labelledby="deletion-title" aria-describedby="deletion-description"
      onCancel={event => { event.preventDefault(); close(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-border bg-surface p-6 text-text-primary shadow-xl backdrop:bg-black/40">
      <p className="text-xs font-semibold uppercase tracking-widest text-danger">Acción irreversible</p>
      <h2 id="deletion-title" className="mt-2 font-heading text-2xl">¿Eliminar tu cuenta?</h2>
      <div id="deletion-description" className="mt-4 space-y-3 text-sm text-text-secondary">
        <p>Se retirarán tus datos activos, prendas, conjuntos y calendario. Se cerrarán tus sesiones y se revocarán tus enlaces y accesos compartidos.</p>
        <p>Las copias legítimas de otras personas se conservan. Las imágenes compartidas no se borran mientras sigan en uso; las demás se limpian en segundo plano.</p>
        <p>Los respaldos cifrados desaparecen según su retención. Este dispositivo se limpiará al continuar; otros dispositivos sin conexión pueden conservar una copia local.</p>
      </div>
      {deleted ? <p role="status" className="mt-4 text-sm font-semibold">Tu cuenta ya fue eliminada. Falta terminar la limpieza de este dispositivo.</p> : (
        <div className="mt-5 space-y-4">
          {status.reauthenticated ? <p className="text-sm font-semibold text-success">Identidad confirmada recientemente con Google.</p> : (
            <>
              <Field label="Contraseña actual" htmlFor="deletion-password">
                <PasswordInput id="deletion-password" autoComplete="current-password" value={password} maxLength={128}
                  disabled={busy} onChange={event => setPassword(event.target.value)} />
              </Field>
              {status.googleAvailable ? <p className="text-xs text-text-muted">Si tu cuenta solo usa Google, utiliza esa opción; no necesitas crear una contraseña.</p> : null}
            </>
          )}
          {status.googleAvailable ? <a href="/api/auth/google/start?intent=delete" aria-disabled={busy} tabIndex={busy ? -1 : 0}
            onClick={event => { if (busy) event.preventDefault(); }} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
            Volver a autenticar con Google
          </a> : null}
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={acknowledge} disabled={busy}
              onChange={event => setAcknowledge(event.target.checked)} />
            Entiendo que no podré recuperar mi cuenta ni sus datos activos.
          </label>
        </div>
      )}
      {!online ? <p role="status" className="mt-3 text-sm text-danger">Necesitas conexión y una sesión vigente.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button ref={cancelRef} type="button" disabled={busy || deleted} onClick={close}
          className="min-h-11 rounded-full border border-border px-5 text-sm font-semibold disabled:opacity-50">Cancelar</button>
        <Button variant="danger" disabled={!canConfirm} loading={busy} onClick={() => { void confirm(); }}>
          {deleted ? 'Terminar limpieza local' : 'Eliminar mi cuenta definitivamente'}
        </Button>
      </div>
    </dialog>
  );
}
