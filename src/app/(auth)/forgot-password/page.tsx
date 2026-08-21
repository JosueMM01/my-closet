'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthError, requestPasswordRecovery } from '@/lib/auth/client';
import { Button, Field, TextInput } from '@/components/ui';

const GENERIC_SUCCESS =
  'Si existe una cuenta activa con ese correo, recibirás un enlace para cambiar tu contraseña.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordRecovery(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'No se pudo procesar la solicitud');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F3EFEA] px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl text-text-primary">Recupera tu contraseña</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Te enviaremos un enlace de un solo uso que vence en 30 minutos.
          </p>
        </div>

        {sent ? (
          <section className="card-surface p-6 text-center" role="status">
            <p className="text-sm leading-relaxed text-text-secondary">{GENERIC_SUCCESS}</p>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="card-surface space-y-4 p-6" noValidate>
            <Field label="Correo electrónico">
              <TextInput
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Enviar enlace
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
