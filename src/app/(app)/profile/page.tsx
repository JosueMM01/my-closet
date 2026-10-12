'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ApiClientError } from '@/lib/api/client';
import { changeEmail, changePassword, updateProfile } from '@/lib/account/client';
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
import { ShareIcon } from '@/components/icons';
import { Button, Field, PasswordInput, TextInput } from '@/components/ui';

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
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState('');
  const [newEmail, setNewEmail] = useState(profile?.email ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [photoStage, setPhotoStage] = useState<string | null>(null);

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

  function begin(action: string) {
    setBusy(action);
    setError(null);
    setStatus(null);
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
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden');
      return;
    }
    begin('password');
    try {
      await changePassword({
        currentPassword: currentPasswordForPassword,
        newPassword,
      });
      setCurrentPasswordForPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await finishProfileChange('Contraseña actualizada y sesión renovada.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo actualizar la contraseña'));
    } finally {
      setBusy(null);
    }
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    begin('email');
    try {
      const updated = await changeEmail({
        currentPassword: currentPasswordForEmail,
        newEmail,
      });
      setCurrentPasswordForEmail('');
      setNewEmail(updated.email);
      await finishProfileChange('Correo actualizado y sesión renovada.');
    } catch (caught) {
      setError(readableError(caught, 'No se pudo actualizar el correo'));
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
          <ProfileAvatar
            imageId={profile.profileImageId}
            displayName={profile.displayName}
            className="h-24 w-24"
          />
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                loading={busy === 'photo'}
                disabled={!online}
              >
                {profile.profileImageId ? 'Cambiar foto' : 'Añadir foto'}
              </Button>
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
        </section>
      ) : null}

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

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <form onSubmit={saveName} className="rounded-2xl bg-surface-alt p-4" noValidate>
            <h3 className="font-heading text-base">Nombre visible</h3>
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
          </form>

          <form onSubmit={savePassword} className="rounded-2xl bg-surface-alt p-4" noValidate>
            <h3 className="font-heading text-base">Cambiar contraseña</h3>
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
              <Field label="Nueva contraseña" hint="Mínimo 8 caracteres" htmlFor="new-password">
                <PasswordInput
                  id="new-password"
                  name="newPassword"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </Field>
              <Field label="Repite la nueva contraseña" htmlFor="confirm-password">
                <PasswordInput
                  id="confirm-password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </Field>
            </div>
            <Button className="mt-3 w-full sm:w-auto" type="submit" loading={busy === 'password'} disabled={!online}>
              Cambiar contraseña
            </Button>
          </form>

          <form onSubmit={saveEmail} className="rounded-2xl bg-surface-alt p-4 lg:col-span-2" noValidate>
            <h3 className="font-heading text-base">Cambiar correo</h3>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Verificamos tu identidad con la contraseña actual, pero todavía no verificamos que seas la persona propietaria del nuevo buzón de correo.
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
            <Button className="mt-3 w-full sm:w-auto" type="submit" loading={busy === 'email'} disabled={!online}>
              Cambiar correo
            </Button>
          </form>
        </div>

        <div className="mt-4 min-h-5" aria-live="polite">
          {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
          {status ? <p className="text-sm font-medium text-success">{status}</p> : null}
        </div>
      </section>

      <ProfileGoogle
        online={online}
        userId={userId}
        profileImageId={profile.profileImageId}
        onProfileChanged={refreshProfile}
      />

      {profile.role === 'ADMIN' ? <ProfileAdmin profile={profile} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
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

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-alt py-3">
      <dt className="font-heading text-xl">{value}</dt>
      <dd className="text-xs text-text-secondary">{label}</dd>
    </div>
  );
}
