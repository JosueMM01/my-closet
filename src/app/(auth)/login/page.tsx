'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthError, login } from '@/lib/auth/client';
import { Button, Field, TextInput } from '@/components/ui';
import { useSession } from '@/components/providers';

export default function LoginPage() {
  const router = useRouter();
  const { profile, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    if (!loading && profile) router.replace('/');
  }, [loading, profile, router]);

  useEffect(() => {
    void fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : { google: false }))
      .then((d: { google: boolean }) => setGoogleEnabled(d.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      router.replace('/');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#B05C78" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 7a2.2 2.2 0 1 1 2.2-2.2" />
              <path d="M12 7v2.5L3.6 15.3a1.6 1.6 0 0 0 .9 2.9h15a1.6 1.6 0 0 0 .9-2.9L12 9.5" />
            </svg>
          </div>
          <h1 className="font-heading text-3xl text-text-primary">My Closet</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Tu armario digital, siempre contigo
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-surface space-y-4 p-6" noValidate>
          <Field label="Correo electrónico">
            <TextInput
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Contraseña">
            <TextInput
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Entrar
          </Button>
          {googleEnabled && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              disabled
              title="Configura GOOGLE_CLIENT_ID para habilitarlo"
            >
              Continuar con Google
            </Button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          ¿Primera vez?{' '}
          <Link href="/register" className="font-semibold text-primary hover:text-primary-hover">
            Crea tu cuenta
          </Link>
        </p>
      </div>
    </main>
  );
}
