'use client';

import { useEffect, useId, useRef } from 'react';

export function ProfileModal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      // React autoFocus may run before a newly mounted dialog is visible.
      dialog.querySelector<HTMLElement>('[data-modal-initial-focus]')?.focus();
    }
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={titleId}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[1.5rem] border-0 bg-white p-5 text-text-primary shadow-xl backdrop:bg-black/40">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="font-heading text-xl">{title}</h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-secondary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-primary">×</button>
      </div>
      {children}
    </dialog>
  );
}
