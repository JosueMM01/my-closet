'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ApiClientError } from '@/lib/api/client';
import { changeEmail, confirmEmailChange, changePassword, updateProfile } from '@/lib/account/client';
import { AuthError, endRemoteSession, logout } from '@/lib/auth/client';
import {
  ImageProcessingError,
  ImageValidationError,
  saveGarmentPhoto,
} from '@/lib/images/image-client';
import { getDB } from '@/lib/local/db';
import { deviceDataCounts } from '@/lib/local/queries';
import { uploadProcessedImage } from '@/lib/local/sync-engine';
import { useSession, useSync } from '@/components/providers';
import { ProfileAdmin } from '@/components/profile-admin';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ProfileGoogle } from '@/components/profile-google';
import { ProfileAccountDeletion } from '@/components/profile-account-deletion';
import { ProfileInstallApp } from '@/components/pwa-install';
import { PencilIcon, ShareIcon } from '@/components/icons';
import { Button, Field, PasswordInput, TextInput } from '@/components/ui';
import { VerificationCodeInput } from '@/components/verification-code-input';

function readableError(error: unknown, fallback: string): string {
  if (
    error instanceof ApiClientError ||
    error instanceof AuthError ||
    error instanceof ImageValidationError ||
    error instanceof ImageProcessingError
  ) {
    return error.message;
  }
  return fallback;
}

export default function ProfilePage() {
  const router = useRouter();
  const { profile, remoteExpired, refreshProfile } = useSession();
  const { stats, online } = useSync();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [currentPasswordForPassword, setCurrentPasswordForPassword] = useState('');
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState('');
  const [newEmail, setNewEmail] = useState(profile?.email ?? '');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const [emailRequestVersion, setEmailRequestVersion] = useState(0);
  const [emailCode, setEmailCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [noticeAction, setNoticeAction] = useState<string | null>(null);
  const [photoStage, setPhotoStage] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState('profile');

  const counts = useLiveQuery(async () => {
    if (!profile) return null;
    const db = getDB();
    const [garments, outfits, entries] = await Promise.all([
      db.garments.where('userId').equals(profile.userId).toArray(),
      db.outfits.where('userId').equals(profile.userId).toArray(),
      db.calendarEntries.where('userId').equals(profile.userId).toArray(),
    ]);
    return deviceDataCounts(garments, outfits, entries);
  }, [profile?.userId]);

  if (!profile) return null;
  const userId = profile.userId;
  const tabs = profile.role === 'ADMIN'
    ? [{ id: 'profile', label: 'Perfil' }, { id: 'security', label: 'Seguridad' }, { id: 'admin', label: 'Administración' }]
    : [{ id: 'profile', label: 'Perfil' }, { id: 'security', label: 'Seguridad' }];
  const activeTab = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : 'profile';

  function begin(action: string) {
    setBusy(action);
    setNoticeAction(action);
    setError(null);
    setStatus(null);
  }

  function feedback(action: string) {
    if (noticeAction !== action) return null;
    return <div className="mt-3" aria-live="polite">
      {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
      {status ? <p className="text-sm font-medium text-success">{status}</p> : null}
    </div>;
  }

  async function finishProfileChange(message: string) {
    await refreshProfile();
    setStatus(message);
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    begin('name');
    try {
      await updateProfile({ displayName });
      await finishProfileChange('Nombre actualizado.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo actualizar el nombre'));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    begin('password');
    try {
      await changePassword({
        currentPassword: currentPasswordForPassword,
      });
      setCurrentPasswordForPassword('');
      setStatus('Si el correo está disponible, recibirás un enlace para cambiar tu contraseña. La contraseña actual sigue vigente hasta completar el proceso.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo solicitar el cambio de contraseña'));
    } finally {
      setBusy(null);
    }
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    begin('email');
    try {
      const requested = await changeEmail({
        currentPassword: currentPasswordForEmail,
        newEmail,
      });
      setCurrentPasswordForEmail('');
      setPendingEmail(requested.email);
      setShowVerification(true);
      setEmailRequestVersion((version) => version + 1);
      setEmailCode('');
      setStatus(`Código enviado a ${requested.email}. Tu correo actual no ha cambiado.`);
    } catch (caught) {
      setError(readableError(caught, 'No se pudo actualizar el correo'));
    } finally {
      setBusy(null);
    }
  }

  async function confirmNewEmail(event: React.FormEvent) {
    event.preventDefault();
    begin('email-confirm');
    try {
      const updated = await confirmEmailChange(emailCode);
      setNewEmail(updated.email);
      setPendingEmail(null);
      setShowVerification(false);
      setEmailCode('');
      await finishProfileChange('Correo verificado y actualizado. Las otras sesiones se cerraron.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo verificar el correo'));
    } finally {
      setBusy(null);
    }
  }

  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    begin('photo');
    setPhotoStage('Procesando la imagen en este dispositivo…');
    try {
      const image = await saveGarmentPhoto(userId, file, {
        removeBackground: false,
        queueForSync: false,
        onProgress: (progress) => setPhotoStage(`${progress.stage}…`),
      });
      setPhotoStage('Subiendo la imagen procesada…');
      const uploaded = await uploadProcessedImage(image.id, userId);
      if (!uploaded) throw new ApiClientError('No se pudo confirmar la subida de la imagen', 0);
      setPhotoStage('Confirmando la imagen del perfil…');
      await updateProfile({ profileImageId: image.id });
      await finishProfileChange('Foto de perfil actualizada.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo actualizar la foto de perfil'));
    } finally {
      setPhotoStage(null);
      setBusy(null);
    }
  }

  async function removePhoto() {
    begin('photo');
    try {
      await updateProfile({ profileImageId: null });
      await finishProfileChange('Foto de perfil eliminada.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo eliminar la foto de perfil'));
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    await logout();
    await refreshProfile();
    router.replace('/login');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Tu cuenta</p>
          <h1 className="mt-1 font-heading text-3xl">Perfil</h1>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${
          profile.role === 'ADMIN'
            ? 'bg-primary text-white'
            : 'bg-primary-soft text-primary'
        }`} data-testid="role-badge">
          {profile.role === 'ADMIN' ? 'ADMINISTRADOR' : 'USUARIO'}
        </span>
      </div>

      <section className="card-surface p-5 sm:p-6" aria-labelledby="identity-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative w-fit shrink-0">
            <ProfileAvatar
              imageId={profile.profileImageId}
              displayName={profile.displayName}
              className="h-24 w-24"
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!online || busy !== null}
              aria-label={profile.profileImageId ? 'Cambiar foto de perfil' : 'Añadir foto de perfil'}
              className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">
              <PencilIcon size={17} />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="identity-title" className="truncate font-heading text-xl">{profile.displayName}</h2>
            <p className="truncate text-sm text-text-secondary">{profile.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={choosePhoto}
                aria-label="Elegir foto de perfil"
              />
              {profile.profileImageId ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={removePhoto}
                  disabled={!online || busy === 'photo'}
                >
                  Quitar foto
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Se redimensiona y convierte a WebP en tu navegador, sin eliminar el fondo.
            </p>
            {photoStage ? <p className="mt-2 text-sm text-primary" role="status">{photoStage}</p> : null}
            {feedback('photo')}
          </div>
        </div>
      </section>

      {remoteExpired ? (
        <section className="card-surface border-warning/40 p-4" role="alert">
          <p className="text-sm font-semibold text-warning">Sesión remota expirada</p>
          <p className="mt-1 text-sm text-text-secondary">
            Tus datos locales siguen a salvo. Inicia sesión de nuevo para cambiar la cuenta o sincronizar.
          </p>
          <Button className="mt-3" loading={busy === 'reauth'} disabled={!online || busy !== null} onClick={async () => {
            begin('reauth');
            try {
              await endRemoteSession();
              router.push('/login?reauth=1&next=/profile');
            } catch (caught) {
              setError(readableError(caught, 'No se pudo preparar el nuevo inicio de sesión'));
            } finally {
              setBusy(null);
            }
          }}>Iniciar sesión de nuevo</Button>
          {feedback('reauth')}
        </section>
      ) : null}

      <div role="tablist" aria-label="Secciones del perfil" className="flex rounded-full bg-surface-alt p-1">
        {tabs.map((tab, index) => (
          <button key={tab.id} id={`profile-tab-${tab.id}`} type="button" role="tab"
            aria-selected={activeTab === tab.id} aria-controls={`profile-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setSelectedTab(tab.id)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              const target = tabs[next];
              if (!target) return;
              setSelectedTab(target.id);
              document.getElementById(`profile-tab-${target.id}`)?.focus();
            }}
            className={`min-h-11 min-w-0 flex-1 rounded-full px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:text-sm ${activeTab === tab.id ? 'bg-white text-primary shadow-sm' : 'text-text-secondary hover:text-primary'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div id="profile-panel-security" role="tabpanel" aria-labelledby="profile-tab-security" hidden={activeTab !== 'security'} className="space-y-5">
      <section className="card-surface p-5 sm:p-6" aria-labelledby="connected-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="connected-title" className="font-heading text-xl">Cuenta y seguridad</h2>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Estos cambios afectan a tu cuenta del servidor y requieren conexión.
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            online ? 'bg-primary-soft text-primary' : 'bg-surface-alt text-warning'
          }`}>
            {online ? 'Con conexión' : 'Sin conexión'}
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <ProfileDisclosure title="Nombre visible" description="Actualiza cómo te ven las demás personas.">
          <form onSubmit={saveName} className="px-4 pb-4" noValidate>
            <div className="mt-3">
              <Field label="Nombre">
                <TextInput
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  maxLength={60}
                />
              </Field>
            </div>
            <Button className="mt-3 w-full sm:w-auto" type="submit" loading={busy === 'name'} disabled={!online}>
              Guardar nombre
            </Button>
            {feedback('name')}
          </form>
          </ProfileDisclosure>

          <ProfileDisclosure title="Cambiar contraseña" description="Solicita un enlace seguro por correo.">
          <form onSubmit={savePassword} className="px-4 pb-4" noValidate>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">Confirma tu contraseña actual y recibirás un enlace en tu correo para elegir una nueva.</p>
            <div className="mt-3 space-y-3">
              <Field label="Contraseña actual" htmlFor="current-password-for-password">
                <PasswordInput
                  id="current-password-for-password"
                  name="currentPassword"
                  autoComplete="current-password"
                  value={currentPasswordForPassword}
                  onChange={(event) => setCurrentPasswordForPassword(event.target.value)}
                  required
                />
              </Field>
            </div>
            <Button className="mt-3 w-full sm:w-auto" type="submit" loading={busy === 'password'} disabled={!online || busy !== null || !currentPasswordForPassword}>
              Solicitar cambio por correo
            </Button>
            <p className="mt-3 text-xs text-text-secondary">¿No tienes contraseña porque entras con Google?{' '}
              <Link href="/forgot-password" className="font-semibold text-primary underline">Solicita un enlace de recuperación</Link>.
            </p>
            {feedback('password')}
          </form>
          </ProfileDisclosure>

          <ProfileDisclosure title="Cambiar correo" description="Verifica tu nueva dirección antes de cambiarla." closeSignal={emailRequestVersion}>
          <form onSubmit={saveEmail} className="px-4 pb-4" noValidate>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Confirma tu contraseña y después copia el código que enviaremos al nuevo buzón. Tu correo actual se conserva hasta verificarlo.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Correo nuevo">
                <TextInput
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  required
                />
              </Field>
              <Field label="Contraseña actual" htmlFor="current-password-for-email">
                <PasswordInput
                  id="current-password-for-email"
                  name="currentPassword"
                  autoComplete="current-password"
                  value={currentPasswordForEmail}
                  onChange={(event) => setCurrentPasswordForEmail(event.target.value)}
                  required
                />
              </Field>
            </div>
            <Button className="mt-3 w-full sm:w-auto" type="submit" loading={busy === 'email'} disabled={!online || busy !== null}>
              Enviar código de verificación
            </Button>
            {feedback('email')}
          </form>
          </ProfileDisclosure>
          {!showVerification ? (
            <button type="button" onClick={() => setShowVerification(true)} className="min-h-11 px-2 text-left text-sm font-semibold text-primary underline underline-offset-4">
              Ya tengo un código de verificación
            </button>
          ) : null}
          {showVerification ? <form onSubmit={confirmNewEmail} className="rounded-2xl bg-surface-alt p-4" noValidate>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-heading text-base">Verificar nuevo correo</h3>
              <button type="button" onClick={() => setShowVerification(false)} className="min-h-11 text-sm font-semibold text-primary underline underline-offset-4">Ocultar</button>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {pendingEmail ? `Escribe el código de 6 dígitos enviado a ${pendingEmail}.` : 'Si ya solicitaste el cambio, escribe el código de 6 dígitos recibido en el nuevo buzón.'}
              {' '}Vence en 10 minutos; solo el último código es válido y tras 5 intentos fallidos debes pedir otro.
            </p>
            <div className="mt-3">
              <VerificationCodeInput value={emailCode} onChange={setEmailCode} disabled={!online || busy !== null} />
            </div>
            <Button className="mt-3" type="submit" loading={busy === 'email-confirm'} disabled={!online || busy !== null || !/^\d{6}$/.test(emailCode)}>
              Confirmar nuevo correo
            </Button>
          </form> : null}
        </div>

        {feedback('email-confirm')}
      </section>

      <ProfileGoogle
        online={online}
        userId={userId}
        profileImageId={profile.profileImageId}
        onProfileChanged={refreshProfile}
      />

      <ProfileAccountDeletion userId={userId} online={online} remoteExpired={remoteExpired} />
      </div>

      {profile.role === 'ADMIN' ? <div id="profile-panel-admin" role="tabpanel" aria-labelledby="profile-tab-admin" hidden={activeTab !== 'admin'}>
        <ProfileAdmin profile={profile} />
      </div> : null}

      <div id="profile-panel-profile" role="tabpanel" aria-labelledby="profile-tab-profile" hidden={activeTab !== 'profile'}>
      <div className="grid items-start gap-5 md:grid-cols-2">
        <section className="card-surface p-5">
          <h2 className="font-heading text-base">Tus datos en este dispositivo</h2>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Count label="Prendas" value={counts?.garments ?? 0} />
            <Count label="Conjuntos" value={counts?.outfits ?? 0} />
            <Count label="Entradas" value={counts?.entries ?? 0} />
          </dl>
          <p className="mt-3 text-xs text-text-secondary">
            {stats.pending + stats.failed === 0
              ? 'Todo sincronizado'
              : `${stats.pending + stats.failed} cambios pendientes`}
          </p>
        </section>

        <section className="card-surface p-5">
          <h2 className="font-heading text-base">Compartir</h2>
          <p className="mt-2 text-sm text-text-secondary">
            Invita a otras personas a ver o gestionar tu armario completo.
          </p>
          <Link
            href="/sharing"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:text-primary-hover"
          >
            <ShareIcon size={16} />
            Gestionar accesos
          </Link>
        </section>
        <ProfileInstallApp />
      </div>

      </div>

      <Button variant="secondary" className="w-full" onClick={handleLogout} data-testid="logout">
        Cerrar sesión
      </Button>
      <p className="pb-4 text-center text-xs text-text-muted">
        Los datos de este dispositivo se conservan al cerrar sesión; la caché administrativa se elimina.
      </p>
    </div>
  );
}

function ProfileDisclosure({ title, description, children, closeSignal }: { title: string; description: string; children: React.ReactNode; closeSignal?: number }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = `profile-modal-${title === 'Nombre visible' ? 'name' : title === 'Cambiar contraseña' ? 'password' : 'email'}`;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  useEffect(() => {
    if (closeSignal) dialogRef.current?.close();
  }, [closeSignal]);
  return (
    <div className="rounded-2xl bg-surface-alt">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span><span className="block text-sm font-semibold text-text-primary">{title}</span><span className="mt-0.5 block text-xs text-text-secondary">{description}</span></span>
        <span aria-hidden="true" className="text-xl text-primary">›</span>
      </button>
      {open ? <dialog ref={dialogRef} onClose={() => setOpen(false)} aria-labelledby={titleId}
        className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[1.5rem] border-0 bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/40">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 id={titleId} className="font-heading text-xl">{title}</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-secondary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-primary">×</button>
        </div>
        {children}
      </dialog> : null}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-alt py-3">
      <dt className="font-heading text-xl">{value}</dt>
      <dd className="text-xs text-text-secondary">{label}</dd>
    </div>
  );
}
