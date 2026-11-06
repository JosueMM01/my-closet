'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

interface TurnstileAPI {
  render(container: HTMLElement, options: {
    sitekey: string; action: string; language: string; size: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }): string;
  remove(id: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileAPI };

export function TurnstileChallenge({ siteKey, action, onToken }: {
  siteKey: string; action: 'login' | 'recovery'; onToken: (token: string | undefined) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  useEffect(() => {
    if (!scriptReady) return;
    // La carga del script y la disponibilidad de su API no siempre coinciden.
    // El reintento es acotado: nunca dejar un formulario bloqueado sin aviso.
    const deadline = Date.now() + 10_000;
    const interval = window.setInterval(() => {
      const api = (window as TurnstileWindow).turnstile;
      if (widget.current !== null) return;
      if (!api || !container.current) {
        if (Date.now() >= deadline) { window.clearInterval(interval); setFailed(true); }
        return;
      }
      window.clearInterval(interval);
      try {
        widget.current = api.render(container.current, {
          sitekey: siteKey, action, language: 'es', size: 'flexible',
          callback: token => { setFailed(false); onToken(token); },
          'expired-callback': () => onToken(undefined),
          'error-callback': () => { onToken(undefined); setFailed(true); },
        });
      } catch { onToken(undefined); setFailed(true); }
    }, 100);
    return () => {
      window.clearInterval(interval);
      if (widget.current !== null) (window as TurnstileWindow).turnstile?.remove(widget.current);
      widget.current = null;
      onToken(undefined);
    };
  }, [scriptReady, siteKey, action, onToken]);
  return <div aria-label="Verificación de seguridad">
    <div ref={container} />
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      onLoad={() => setScriptReady(true)} onReady={() => setScriptReady(true)}
      onError={() => { setFailed(true); onToken(undefined); }} />
    {failed ? <p role="alert" className="text-sm text-danger">No se pudo cargar la verificación. Revisa la conexión y recarga la página.</p> : null}
  </div>;
}
