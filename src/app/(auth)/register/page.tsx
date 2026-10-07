'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthError, fetchAuthProviders, logout, register } from '@/lib/auth/client';
import {
  apiErrorResponseSchema,
  invitationInspectionResponseSchema,
} from '@/lib/domain/validation';
import { Button, Field, PasswordInput, TextInput } from '@/components/ui';
import { GoogleIcon } from '@/components/google-icon';
import { useSession } from '@/components/providers';
import { LegalLinks } from '@/components/legal-links';
import { googleFailureMessage } from '@/lib/auth/google-feedback';

interface InvitationView {
  email: string;
  role: 'USER' | 'ADMIN';
  expiresAt: string;
  googleAvailable: boolean;
}

export default function RegisterPage() {
  const router = useRouter();
  const { profile, loading, refreshProfile } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [registrationReady, setRegistrationReady] = useState(false);
  const [publicRegistration, setPublicRegistration] = useState(false);
  // Solo memoria de esta página: Strict Mode puede repetir el efecto después
  // de retirar el fragmento, sin que eso deba perder la invitación.
  const initialToken = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const googleResult = new URL(window.location.href).searchParams.get('google');
    if (initialToken.current === undefined) {
      initialToken.current = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    }
    const token = initialToken.current;
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    queueMicrotask(() => {
      setInvitationToken(token);
      const googleError = googleFailureMessage(googleResult);
      if (googleError) setError(googleError);
    });

    void Promise.all([
      fetchAuthProviders(),
      token
        ? fetch('/api/auth/invitation', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-requested-with': 'my-closet' },
            body: JSON.stringify({ token }),
          })
        : Promise.resolve(null),
    ])
      .then(async ([providers, invitationResponse]) => {
        setPublicRegistration(providers.publicRegistration);
        if (!invitationResponse) return;
        if (!invitationResponse.ok) {
          const parsedError = apiErrorResponseSchema.safeParse(
            await invitationResponse.json().catch(() => null),
          );
          throw new AuthError(
            parsedError.success ? parsedError.data.error : 'La invitación no es válida',
            invitationResponse.status,
          );
        }
        setInvitation(invitationInspectionResponseSchema.parse(await invitationResponse.json()));
      })
      .catch((caught) => {
        setPublicRegistration(false);
        setError(caught instanceof AuthError ? caught.message : 'No se pudo comprobar la invitación');
      })
      .finally(() => setRegistrationReady(true));
  }, []);

  const passwordWeak = password.length > 0 && password.length < 8;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (profile || loading) return;
    setError(null);
    if (passwordWeak) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        displayName,
        password,
        ...(invitationToken && invitation ? { invitationToken } : { email }),
      });
      await refreshProfile();
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof AuthError ? caught.message : 'No se pudo crear la cuenta');
    } finally {
      setSubmitting(false);
    }
  }

  const canRegister = publicRegistration || Boolean(invitationToken && invitation);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl text-text-primary">Crear cuenta</h1>
          <p className="mt-2 text-sm text-text-secondary">Tu armario, tus conjuntos, tu calendario</p>
        </div>

        {profile ? (
          <section className="card-surface space-y-4 p-6" aria-labelledby="invite-account-switch">
            <h2 id="invite-account-switch" className="font-heading text-xl">Hay una cuenta abierta en este dispositivo</h2>
            <p className="text-sm text-text-secondary">Para aceptar la invitación con otra cuenta, cierra primero la sesión de {profile.email}. Sus prendas y cambios pendientes permanecerán guardados en este dispositivo.</p>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <Button loading={submitting} onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await logout({ requireRemote: true });
                await refreshProfile();
              } catch (caught) {
                setError(caught instanceof AuthError ? caught.message : 'No se pudo cerrar la sesión. Revisa la conexión.');
              } finally { setSubmitting(false); }
            }}>Cerrar sesión para aceptar la invitación</Button>
          </section>
        ) : !registrationReady || loading ? (
          <div className="card-surface flex min-h-32 items-center justify-center p-6" role="status">
            <span className="text-sm text-text-secondary">Comprobando invitación…</span>
          </div>
        ) : !canRegister ? (
          <section className="card-surface p-6 text-center" aria-labelledby="invite-required-title">
            <h2 id="invite-required-title" className="font-heading text-xl">
              {error ? 'Invitación no disponible' : 'Necesitas una invitación'}
            </h2>
            <p
              className={`mt-2 text-sm leading-relaxed ${error ? 'text-danger' : 'text-text-secondary'}`}
              role={error ? 'alert' : undefined}
            >
              {error ?? 'El registro público está cerrado. Abre el enlace de invitación que recibiste para crear tu cuenta.'}
            </p>
          </section>
        ) : (
          <div className="card-surface space-y-5 p-6">
            {invitation ? (
              <div className="rounded-2xl bg-primary-soft p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">Invitación verificada</p>
                <p className="mt-1 break-all text-sm font-semibold text-text-primary">{invitation.email}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Rol: {invitation.role === 'ADMIN' ? 'Administrador' : 'Usuario'}
                </p>
              </div>
            ) : null}

            {invitation?.googleAvailable && invitationToken ? (
              <>
                <form action="/api/auth/google/start" method="post">
                  <input type="hidden" name="invitationToken" value={invitationToken} />
                  <button
                    type="submit"
                    className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-[#747775] bg-white px-3 text-sm font-medium text-[#1F1F1F] transition-colors hover:bg-gray-50"
                  >
                    <GoogleIcon />
                    <span>Iniciar sesión con Google</span>
                  </button>
                </form>
                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-text-muted">o crea una contraseña</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Field label="Nombre">
                <TextInput
                  type="text"
                  name="displayName"
                  autoComplete="name"
                  placeholder="María"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </Field>
              {invitation ? null : (
                <Field label="Correo electrónico">
                  <TextInput
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </Field>
              )}
              <Field
                label="Contraseña"
                hint="Mínimo 8 caracteres"
                error={passwordWeak ? 'Al menos 8 caracteres' : undefined}
                htmlFor="register-password"
              >
                <PasswordInput
                  id="register-password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                />
              </Field>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" size="lg" className="w-full" loading={submitting}>
                Crear cuenta
              </Button>
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">
            Inicia sesión
          </Link>
        </p>
        <div className="mt-4"><LegalLinks /></div>
      </div>
    </main>
  );
}
