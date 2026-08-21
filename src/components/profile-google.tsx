'use client';

import { useEffect, useState } from 'react';
import {
  apiErrorResponseSchema,
  googleLinkStatusResponseSchema,
  operationSuccessResponseSchema,
} from '@/lib/domain/validation';
import { fetchAuthProviders } from '@/lib/auth/client';
import { Button } from '@/components/ui';

export function ProfileGoogle({ online }: { online: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const googleResult = url.searchParams.get('google');
    if (googleResult) {
      url.searchParams.delete('google');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    void fetchAuthProviders()
      .then(async (providers) => {
        if (googleResult === 'linked') setMessage('Google Sign-In vinculado.');
        if (googleResult === 'denied') setMessage('No se pudo completar Google Sign-In.');
        if (!providers.google) return;
        setEnabled(true);
        const response = await fetch('/api/profile/google', { cache: 'no-store' });
        if (!response.ok) throw new Error('Google status unavailable');
        const status = googleLinkStatusResponseSchema.parse(await response.json());
        setLinkedEmail(status.linked ? status.providerEmail : null);
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoaded(true));
  }, []);

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
          ? `Vinculado con ${linkedEmail}. Tu contraseña sigue disponible.`
          : 'Vincula la cuenta de Google que usa exactamente el mismo correo de tu perfil.'}
      </p>
      <div className="mt-3">
        {linkedEmail ? (
          <Button
            type="button"
            variant="secondary"
            onClick={unlink}
            loading={busy}
            disabled={!online}
          >
            Desvincular Google
          </Button>
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
