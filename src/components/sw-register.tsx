'use client';

/**
 * Registro del Service Worker + actualización controlada.
 * Escucha mensajes del SW (Background Sync) para disparar el sync engine.
 */
import { useEffect, useState } from 'react';
import { runSync } from '@/lib/local/sync-engine';

export function ServiceWorkerRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      // file:// o redes no seguras: SW no disponible.
      return;
    }

    let refreshing = false;
    // Solo recargar en ACTUALIZACIONES (ya había un SW controlando);
    // la primera instalación no debe recargar la página a media carga.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (!hadController) return;
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    async function register() {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

        // Background Sync fallback → sync engine del cliente.
        navigator.serviceWorker.addEventListener('message', (event) => {
          if ((event.data as { type?: string })?.type === 'RUN_SYNC') {
            void runSync().catch(() => undefined);
          }
        });
      } catch {
        // SW no crítico para la app (IndexedDB sigue funcionando).
      }
    }

    void register();
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-28 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card md:bottom-8"
    >
      <p className="flex-1 text-sm font-medium">Hay una nueva versión disponible.</p>
      <button
        type="button"
        onClick={() => {
          void navigator.serviceWorker
            .getRegistration()
            .then((registration) => registration?.waiting?.postMessage('SKIP_WAITING'));
        }}
        className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
      >
        Actualizar
      </button>
    </div>
  );
}
