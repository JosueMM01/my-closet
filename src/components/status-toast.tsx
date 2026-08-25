'use client';

import { useEffect } from 'react';

export function StatusToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(onDismiss, 4_000);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-[max(5rem,env(safe-area-inset-top))] z-50 w-[min(calc(100%-2rem),28rem)] -translate-x-1/2 rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm font-semibold text-text-primary shadow-card"
      data-testid="share-status"
    >
      {message}
    </div>
  );
}
