'use client';

import { useRef } from 'react';

/** Seis casillas accesibles; el código y los huecos se conservan solo en memoria. */
export function VerificationCodeInput({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  function write(index: number, text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    const start = digits.length === 6 ? 0 : index;
    const next = Array.from({ length: 6 }, (_, i) => value[i]?.trim() ?? '');
    if (!digits) next[index] = '';
    else for (let i = 0; i < digits.length && start + i < 6; i++) next[start + i] = digits[i] ?? '';
    onChange(next.map(digit => digit || ' ').join('').trimEnd());
    inputs.current[Math.min(start + digits.length, 5)]?.focus();
  }
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-sm font-semibold text-text-primary">Código de verificación</legend>
      <div className="grid max-w-sm grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <input key={index} ref={element => { inputs.current[index] = element; }}
            aria-label={`Dígito ${index + 1} de 6`} type="text" inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'} pattern="[0-9]*" maxLength={6}
            value={value[index]?.trim() ?? ''} required
            className="h-12 min-w-0 rounded-xl border border-border bg-surface text-center text-xl font-semibold tabular-nums text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            onFocus={event => event.currentTarget.select()}
            onChange={event => write(index, event.target.value)}
            onPaste={event => {
              event.preventDefault();
              const text = event.clipboardData.getData('text');
              if (/\d/.test(text)) write(index, text);
            }}
            onKeyDown={event => {
              if (event.key === 'Backspace') {
                event.preventDefault();
                const target = value[index]?.trim() ? index : Math.max(0, index - 1);
                write(target, '');
                inputs.current[target]?.focus();
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                inputs.current[Math.max(0, Math.min(5, index + (event.key === 'ArrowLeft' ? -1 : 1)))]?.focus();
              }
            }} />
        ))}
      </div>
    </fieldset>
  );
}
