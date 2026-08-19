'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthError, register } from '@/lib/auth/client';
import { Button, Field, TextInput } from '@/components/ui';
import { useSession } from '@/components/providers';

export default function RegisterPage() {
  const router = useRouter();
  const { profile, loading, refreshProfile } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && profile) router.replace('/');
  }, [loading, profile, router]);

  const passwordWeak = password.length > 0 && password.length < 8;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passwordWeak) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSubmitting(true);
    try {
      await register({ displayName, email, password });
      await refreshProfile(); // sincroniza el contexto de sesión con IndexedDB
      router.replace('/');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl text-text-primary">Crear cuenta</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Tu armario, tus conjuntos, tu calendario
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-surface space-y-4 p-6" noValidate>
          <Field label="Nombre">
            <TextInput
              type="text"
              name="displayName"
              autoComplete="name"
              placeholder="María"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </Field>
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
          <Field
            label="Contraseña"
            hint="Mínimo 8 caracteres"
            error={passwordWeak ? 'Al menos 8 caracteres' : undefined}
          >
            <TextInput
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Crear cuenta
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
