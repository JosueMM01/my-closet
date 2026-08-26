'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { apiErrorResponseSchema, wardrobeInvitationResponseSchema } from '@/lib/domain/validation';

export function AcceptWardrobeInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptInvitation() {
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sharing/invitations/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'x-requested-with': 'my-closet' },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorResponseSchema.safeParse(body);
        setError(parsedError.success ? parsedError.data.error : 'No se pudo aceptar la invitación');
        return;
      }
      wardrobeInvitationResponseSchema.parse(body);
      router.refresh();
    } catch {
      setError('No se pudo aceptar la invitación');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="button" loading={accepting} onClick={() => void acceptInvitation()}>
        Aceptar invitación
      </Button>
    </div>
  );
}
