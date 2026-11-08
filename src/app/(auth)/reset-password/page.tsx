'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthError, inspectPasswordResetToken, resetPassword } from '@/lib/auth/client';
import { Button, Field, PasswordInput } from '@/components/ui';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [inspection, setInspection] = useState<'checking' | 'valid' | 'invalid' | 'unavailable'>('checking');
  const [retry, setRetry] = useState(0);
  const initialToken = useRef<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (initialToken.current === undefined) {
      initialToken.current = new URLSearchParams(window.location.hash.slice(1)).get('token');
    }
    const fragmentToken = initialToken.current;
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    const controller = new AbortController();
    if (!fragmentToken) {
      queueMicrotask(() => { if (!controller.signal.aborted) setInspection('invalid'); });
    } else {
      void inspectPasswordResetToken(fragmentToken, controller.signal).then(valid => {
        if (controller.signal.aborted) return;
        setToken(valid ? fragmentToken : null);
        setInspection(valid ? 'valid' : 'invalid');
      }).catch(() => { if (!controller.signal.aborted) setInspection('unavailable'); });
    }
    return () => controller.abort();
  }, [retry]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError('El enlace no es válido o ha expirado');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword: password });
      setToken(null);
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (caught) {
      if (caught instanceof AuthError && caught.status === 400 && caught.message === 'El enlace no es válido o ha expirado') {
        setToken(null);
        setPassword('');
        setConfirmation('');
        setInspection('invalid');
      } else setError(caught instanceof AuthError ? caught.message : 'No se pudo cambiar la contraseña');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F3EFEA] px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl text-text-primary">{inspection === 'invalid' ? 'Enlace no disponible' : 'Crea una contraseña nueva'}</h1>
          {inspection === 'valid' && !complete ? <p className="mt-2 text-sm text-text-secondary">Usa al menos 8 caracteres.</p> : null}
        </div>

        {inspection === 'checking' ? (
          <div className="card-surface p-6 text-center text-sm text-text-secondary" role="status">
            Comprobando enlace…
          </div>
        ) : inspection === 'unavailable' ? (
          <section className="card-surface p-6 text-center" role="alert">
            <p className="text-sm text-danger">No se pudo comprobar el enlace. Revisa tu conexión e inténtalo de nuevo.</p>
            <Button className="mt-4" onClick={() => { setInspection('checking'); setRetry(value => value + 1); }}>Reintentar</Button>
          </section>
        ) : complete ? (
          <section className="card-surface p-6 text-center" role="status">
            <p className="text-sm text-text-secondary">Tu contraseña se actualizó correctamente.</p>
            <Link
              href="/login?reauth=1"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary hover:text-primary-hover"
            >
              Iniciar sesión
            </Link>
          </section>
        ) : !token ? (
          <section className="card-surface p-6 text-center" role="alert">
            <p className="text-sm text-danger">El enlace no es válido o ha expirado.</p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary hover:text-primary-hover"
            >
              Solicitar otro enlace
            </Link>
            <Link href="/login?reauth=1" className="ml-4 inline-flex min-h-11 items-center font-semibold text-primary hover:text-primary-hover">
              Iniciar sesión
            </Link>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="card-surface space-y-4 p-6" noValidate>
            <Field label="Nueva contraseña" hint="Mínimo 8 caracteres" htmlFor="reset-password">
              <PasswordInput
                id="reset-password"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </Field>
            <Field label="Repite la contraseña" htmlFor="reset-password-confirmation">
              <PasswordInput
                id="reset-password-confirmation"
                name="passwordConfirmation"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={8}
                required
              />
            </Field>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Cambiar contraseña
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
