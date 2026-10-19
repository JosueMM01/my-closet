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
  useEffect(() => () => {
    if (widget.current !== null) (window as TurnstileWindow).turnstile?.remove(widget.current);
  }, []);
  function render() {
    const api = (window as TurnstileWindow).turnstile;
    if (!api || !container.current || widget.current !== null) return;
    widget.current = api.render(container.current, {
      sitekey: siteKey, action, language: 'es', size: 'flexible',
      callback: token => { setFailed(false); onToken(token); },
      'expired-callback': () => onToken(undefined),
      'error-callback': () => { onToken(undefined); setFailed(true); },
    });
  }
  return <div aria-label="Verificación de seguridad">
    <div ref={container} />
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      onReady={render} onError={() => { setFailed(true); onToken(undefined); }} />
    {failed ? <p role="alert" className="text-sm text-danger">No se pudo cargar la verificación. Revisa la conexión y recarga la página.</p> : null}
  </div>;
}
