'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';

// Chromium-only enhancement. Safari and other browsers receive manual instructions.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  installed: boolean;
  available: boolean;
  appleMobile: boolean;
  busy: boolean;
  message: string | null;
  install: () => Promise<void>;
}

const InstallContext = createContext<InstallState | null>(null);

/** Capture the one-shot event before the user navigates to Profile. No storage or network. */
export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const pending = useRef<InstallPromptEvent | null>(null);
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [appleMobile, setAppleMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const syncDisplay = () => setInstalled(display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const onPrompt = (event: Event) => {
      const candidate = event as Partial<InstallPromptEvent>;
      if (typeof candidate.prompt !== 'function' || !candidate.userChoice) return;
      event.preventDefault();
      pending.current = event as InstallPromptEvent;
      setAvailable(true);
      setMessage(null);
    };
    const onInstalled = () => {
      pending.current = null;
      setAvailable(false);
      setInstalled(true);
      setMessage(null);
    };
    const detectDevice = () => setAppleMobile(/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    syncDisplay();
    detectDevice();
    display.addEventListener('change', syncDisplay);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      display.removeEventListener('change', syncDisplay);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const event = pending.current;
    if (!event) return;
    // Consume before awaiting: a prompt cannot be reused, including after dismissal.
    pending.current = null;
    setAvailable(false);
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      setMessage(choice.outcome === 'accepted'
        ? 'Completa la instalación en el aviso del navegador.'
        : 'No se instaló la app. Puedes hacerlo más adelante desde el menú del navegador.');
    } catch {
      setMessage('No se pudo abrir el instalador. Consulta las instrucciones para tu navegador.');
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(() => ({ installed, available, appleMobile, busy, message, install }),
    [installed, available, appleMobile, busy, message, install]);
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function ProfileInstallApp() {
  const state = useContext(InstallContext);
  if (!state || state.installed) return null;
  return (
    <section className="card-surface p-5" aria-labelledby="install-app-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="install-app-title" className="font-heading text-base">My Closet en tu dispositivo</h2>
          <p className="mt-1 text-sm text-text-secondary">Ábrelo desde tu pantalla de inicio, como una app.</p>
        </div>
        {state.available || state.busy ? <Button type="button" onClick={() => void state.install()} loading={state.busy}>
          Instalar app
        </Button> : null}
      </div>
      {state.message ? <p role="status" className="mt-3 text-sm text-text-secondary">{state.message}</p> : null}
      <details className="mt-3 rounded-2xl bg-surface-alt px-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {state.appleMobile ? 'Instalar en iPhone o iPad' : 'Cómo instalar la app'}
        </summary>
        <div className="pb-4 text-sm text-text-secondary">
          {state.appleMobile ? <ol className="list-decimal space-y-2 pl-5">
            <li>Abre My Closet en Safari.</li>
            <li>Toca Compartir y elige «Añadir a pantalla de inicio».</li>
            <li>Si aparece «Abrir como app web», déjalo activado y toca «Añadir».</li>
          </ol> : <p>Abre el menú de tu navegador y busca «Instalar app» o «Añadir a pantalla de inicio». En computadora, busca también el icono de instalación en la barra de direcciones. Si no aparece, ese navegador puede no ofrecer instalación.</p>}
          <p className="mt-3 text-xs">No necesitas otra cuenta: inicia sesión con el mismo correo. La instalación y la disponibilidad sin conexión dependen de tu navegador y de los datos ya sincronizados.</p>
        </div>
      </details>
    </section>
  );
}
