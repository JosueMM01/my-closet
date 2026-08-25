'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  apiErrorResponseSchema,
  googleLinkStatusResponseSchema,
  googlePictureAvailabilitySchema,
  operationSuccessResponseSchema,
} from '@/lib/domain/validation';
import { fetchAuthProviders } from '@/lib/auth/client';
import { updateProfile } from '@/lib/account/client';
import { replaceLocalImageBlob, saveGarmentPhoto } from '@/lib/images/image-client';
import { getDB } from '@/lib/local/db';
import { uploadProcessedImage } from '@/lib/local/sync-engine';
import { Button } from '@/components/ui';

interface ProfileGoogleProps {
  online: boolean;
  userId: string;
  profileImageId: string | null;
  onProfileChanged: () => Promise<void>;
}

export function ProfileGoogle({
  online,
  userId,
  profileImageId,
  onProfileChanged,
}: ProfileGoogleProps) {
  const [enabled, setEnabled] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [pictureAvailable, setPictureAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const importGooglePicture = useCallback(async () => {
    setBusy(true);
    setMessage('Procesando la foto de Google en este dispositivo…');
    try {
      const response = await fetch('/api/profile/google/picture?mode=content', { cache: 'no-store' });
      if (!response.ok) throw new Error('La foto de Google ya no está disponible');
      const blob = await response.blob();
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const processed = await saveGarmentPhoto(
        userId,
        new File([blob], `foto-google.${extension}`, { type: blob.type }),
        { removeBackground: false, queueForSync: false },
      );

      let targetImageId = processed.id;
      if (profileImageId) {
        const processedBlob = processed.blob;
        if (!processedBlob || processed.width === null || processed.height === null) {
          throw new Error('No se pudo preparar la foto de Google');
        }
        await replaceLocalImageBlob(
          profileImageId,
          processedBlob,
          processed.width,
          processed.height,
        );
        await getDB().images.delete(processed.id);
        targetImageId = profileImageId;
      }

      const uploaded = await uploadProcessedImage(targetImageId, userId);
      if (!uploaded) throw new Error('No se pudo subir la foto de Google');
      if (profileImageId !== targetImageId) {
        await updateProfile({ profileImageId: targetImageId });
      }
      await fetch('/api/profile/google/picture', {
        method: 'DELETE',
        headers: { 'x-requested-with': 'my-closet' },
      });
      setPictureAvailable(false);
      await onProfileChanged();
      setMessage('Foto de Google aplicada. Puedes cambiarla cuando quieras.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo importar la foto de Google');
    } finally {
      setBusy(false);
    }
  }, [onProfileChanged, profileImageId, userId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const googleResult = url.searchParams.get('google');
    const pictureMode = url.searchParams.get('googlePicture');
    if (googleResult || pictureMode) {
      url.searchParams.delete('google');
      url.searchParams.delete('googlePicture');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    void fetchAuthProviders()
      .then(async (providers) => {
        if (googleResult === 'linked') setMessage('Google Sign-In vinculado.');
        if (googleResult === 'invited') setMessage('Cuenta creada con Google.');
        if (googleResult === 'picture') setMessage('Foto de Google disponible para importar.');
        if (googleResult === 'denied') setMessage('No se pudo completar Google Sign-In.');
        if (!providers.google) return;
        setEnabled(true);
        const [statusResponse, pictureResponse] = await Promise.all([
          fetch('/api/profile/google', { cache: 'no-store' }),
          fetch('/api/profile/google/picture?mode=availability', { cache: 'no-store' }),
        ]);
        if (!statusResponse.ok) throw new Error('Google status unavailable');
        const status = googleLinkStatusResponseSchema.parse(await statusResponse.json());
        setLinkedEmail(status.linked ? status.providerEmail : null);
        const availability = pictureResponse.ok
          ? googlePictureAvailabilitySchema.parse(await pictureResponse.json()).available
          : false;
        setPictureAvailable(availability);
        if (availability && pictureMode === 'auto' && !profileImageId) {
          await importGooglePicture();
        }
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoaded(true));
  }, [importGooglePicture, profileImageId]);

  async function unlink() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/profile/google', {
        method: 'DELETE',
        headers: { 'x-requested-with': 'my-closet' },
      });
      if (!response.ok) {
        const error = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
        throw new Error(error.success ? error.data.error : 'No se pudo desvincular Google');
      }
      operationSuccessResponseSchema.parse(await response.json());
      setLinkedEmail(null);
      setPictureAvailable(false);
      setMessage('Google Sign-In desvinculado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo desvincular Google');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !enabled) return null;

  return (
    <section className="card-surface p-5 sm:p-6" aria-labelledby="google-sign-in-title">
      <h2 id="google-sign-in-title" className="font-heading text-lg">Google Sign-In</h2>
      <p className="mt-1 text-sm text-text-secondary">
        {linkedEmail
          ? `Vinculado con ${linkedEmail}. Tu foto personalizada siempre tiene prioridad.`
          : 'Vincula la cuenta de Google que usa exactamente el mismo correo de tu perfil.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {linkedEmail ? (
          <>
            {pictureAvailable ? (
              <Button
                type="button"
                onClick={() => void importGooglePicture()}
                loading={busy}
                disabled={!online}
              >
                Usar foto de Google
              </Button>
            ) : (
              <a
                href="/api/auth/google/start?intent=photo"
                aria-disabled={!online || busy}
                className={`inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-white ${
                  online && !busy ? 'hover:bg-primary-hover' : 'pointer-events-none opacity-50'
                }`}
              >
                Volver a importar foto
              </a>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={unlink}
              loading={busy}
              disabled={!online}
            >
              Desvincular Google
            </Button>
          </>
        ) : (
          <a
            href="/api/auth/google/start?intent=link"
            aria-disabled={!online}
            className={`inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-semibold ${
              online ? 'text-text-primary hover:bg-surface-alt' : 'pointer-events-none opacity-50'
            }`}
          >
            Vincular Google
          </a>
        )}
      </div>
      {message ? <p className="mt-3 text-sm text-text-secondary" role="status">{message}</p> : null}
    </section>
  );
}
