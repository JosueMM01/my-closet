'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthError, login } from '@/lib/auth/client';
import { Button, Field, TextInput } from '@/components/ui';
import { useSession } from '@/components/providers';

export default function LoginPage() {
  const router = useRouter();
  const { profile, loading, refreshProfile } = useSession();
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
      await refreshProfile(); // sincroniza el contexto de sesión con IndexedDB
      router.replace('/');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#F3EFEA] relative overflow-hidden">
      {/* Background Image Area (Top Half) */}
      <div 
        className="absolute top-0 left-0 right-0 h-[55vh] bg-cover bg-center" 
        style={{ backgroundImage: 'url(/login-bg.jpg)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent pointer-events-none" />
      </div>
      
      {/* Logo and Title overlapping the background image slightly higher */}
      <div className="relative z-10 w-full px-6 pt-12 pb-6">
        <div className="mb-2">
          <div className="mb-4 flex items-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 7a2.2 2.2 0 1 1 2.2-2.2" />
              <path d="M12 7v2.5L3.6 15.3a1.6 1.6 0 0 0 .9 2.9h15a1.6 1.6 0 0 0 .9-2.9L12 9.5" />
            </svg>
          </div>
          <h1 className="font-heading text-4xl text-text-primary tracking-tight mb-1">My Closet</h1>
          <p className="text-lg text-text-secondary leading-snug">
            Tu armario digital<br />siempre contigo.
          </p>
        </div>
      </div>

      {/* Bottom Sheet Card */}
      <div className="relative z-20 mt-auto w-full bg-surface rounded-t-[2.5rem] shadow-[0_-8px_32px_rgba(0,0,0,0.08)] px-6 pt-8 pb-10">
        <div className="max-w-md mx-auto">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-text-primary mb-1">Te damos la bienvenida</h2>
              <p className="text-sm text-text-secondary">Inicia sesión para entrar en tu armario.</p>
            </div>

            <Field label="Correo electrónico">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-text-muted pointer-events-none">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7l8 5 8-5M4 7v10a2 2 0 002 2h12a2 2 0 002-2V7M4 7a2 2 0 012-2h12a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <TextInput
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </Field>
            <Field label="Contraseña">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-text-muted pointer-events-none">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <TextInput
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                />
              </div>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-danger font-medium">
                {error}
              </p>
            )}
            
            <div className="pt-2 flex flex-col gap-3">
              <Button type="submit" size="lg" className="w-full font-medium text-[15px]" loading={submitting}>
                Entrar
              </Button>
              <Link href="/register" className="w-full">
                <Button type="button" variant="secondary" size="lg" className="w-full bg-transparent font-medium text-[15px] border-border hover:bg-surface-alt">
                  Crear cuenta
                </Button>
              </Link>
            </div>

            {googleEnabled && (
              <>
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-border"></div>
                  <span className="mx-4 text-xs font-medium text-text-muted">O</span>
                  <div className="flex-grow border-t border-border"></div>
                </div>
                <a
                  href="/api/auth/google"
                  className="inline-flex h-12 w-full items-center justify-center rounded-full border border-border bg-transparent px-6 text-[15px] font-semibold text-text-primary transition-colors hover:bg-surface-alt"
                >
                  Continuar con Google
                </a>
              </>
            )}
          </form>

        </div>
      </div>
    </main>
  );
}
