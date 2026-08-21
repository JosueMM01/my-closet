'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthError, resetPassword } from '@/lib/auth/client';
import { Button, Field, PasswordInput } from '@/components/ui';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = fragment.get('token');
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    queueMicrotask(() => {
      setToken(fragmentToken);
      setReady(true);
    });
  }, []);

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
      setError(caught instanceof AuthError ? caught.message : 'No se pudo cambiar la contraseña');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F3EFEA] px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl text-text-primary">Crea una contraseña nueva</h1>
          <p className="mt-2 text-sm text-text-secondary">Usa al menos 8 caracteres.</p>
        </div>

        {!ready ? (
          <div className="card-surface p-6 text-center text-sm text-text-secondary" role="status">
            Comprobando enlace…
          </div>
        ) : complete ? (
          <section className="card-surface p-6 text-center" role="status">
            <p className="text-sm text-text-secondary">Tu contraseña se actualizó correctamente.</p>
            <Link
              href="/login"
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
