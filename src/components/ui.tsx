'use client';

/**
 * Kit de componentes UI — Soft Editorial Closet.
 * Mobile-first, touch targets ≥44px, accesible.
 */
import clsx from 'clsx';
import {
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CloudOffIcon, CloudSyncIcon, WarningIcon } from './icons';
import { useSync } from './providers';

// --- Button -----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg' | 'icon';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover active:bg-primary-hover shadow-soft',
  secondary:
    'bg-surface text-text-primary border border-border hover:bg-surface-alt',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-alt',
  danger: 'bg-surface text-danger border border-danger/30 hover:bg-danger/10',
};

const buttonSizes: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-11 w-11',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

// --- Field / Input ------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const content = (
    <>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-text-primary">
          {label}
        </label>
      ) : (
        <span className="mb-1.5 block text-sm font-semibold text-text-primary">{label}</span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
  if (htmlFor) return <div className="block">{content}</div>;
  return (
    <label className="block">
      {content}
    </label>
  );
}

const inputBase =
  'w-full h-11 rounded-xl border border-border bg-surface px-3.5 text-[15px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none transition-colors';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputBase, className)} {...rest} />;
}

export function PasswordInput({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className={clsx(inputBase, 'pr-12', className)}
        {...rest}
      />
      <button
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex h-11 w-11 items-center justify-center rounded-r-xl text-text-secondary transition-colors hover:bg-surface-alt hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      >
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
            <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a16.7 16.7 0 0 1-2.1 2.8M6.6 6.7C4.3 8.2 3 10 3 10s3.5 5 9 5c1 0 2-.2 2.9-.5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" />
            <circle cx="12" cy="10" r="2" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(inputBase, 'h-auto min-h-24 py-2.5 leading-relaxed', className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputBase, 'appearance-none pr-9', className)} {...rest}>
      {children}
    </select>
  );
}

// --- Chip ---------------------------------------------------------------------

export function Chip({
  active,
  onClick,
  children,
  className,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border bg-surface text-text-secondary hover:bg-surface-alt',
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- EmptyState -----------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-surface flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-alt text-text-muted">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-lg text-text-primary">{title}</h3>
      {description && <p className="max-w-xs text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// --- SyncBadge -------------------------------------------------------------------

export function SyncBadge() {
  return (
    <span
      data-testid="sync-badge"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-alt px-3 py-1 text-xs font-medium text-text-secondary"
    >
      <SyncBadgeContent />
    </span>
  );
}

function SyncBadgeContent() {
  const { stats, running, online } = useSync();
  if (!online) {
    return (
      <>
        <CloudOffIcon size={14} />
        Sin conexión · {stats.pending} pendiente{stats.pending === 1 ? '' : 's'}
      </>
    );
  }
  if (stats.failed > 0) {
    return (
      <>
        <WarningIcon size={14} className="text-warning" />
        {stats.failed} sin sincronizar
      </>
    );
  }
  if (running || stats.syncing > 0) {
    return (
      <>
        <CloudSyncIcon size={14} className="animate-pulse" />
        Sincronizando…
      </>
    );
  }
  if (stats.pending > 0) {
    return (
      <>
        <CloudSyncIcon size={14} />
        {stats.pending} pendiente{stats.pending === 1 ? '' : 's'}
      </>
    );
  }
  return (
    <>
      <CloudSyncIcon size={14} className="text-success" />
      Sincronizado
    </>
  );
}

// --- Modal ------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="card-surface w-full max-w-md rounded-b-none p-6 sm:rounded-[1.25rem] max-h-[85vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- Confirm -----------------------------------------------------------------------

export { ConfirmDialog } from './confirm-dialog';
