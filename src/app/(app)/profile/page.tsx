'use client';

/**
 * Perfil: datos de la cuenta local, estado de sincronización,
 * cerrar sesión (conserva datos offline) y ajustes de la app.
 */
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession, useSync } from '@/components/providers';
import { logout } from '@/lib/auth/client';
import { getDB } from '@/lib/local/db';
import { Button } from '@/components/ui';
import { ShareIcon } from '@/components/icons';
import Link from 'next/link';

export default function ProfilePage() {
  const router = useRouter();
  const { profile, remoteExpired } = useSession();
  const { stats, online } = useSync();

  const counts = useLiveQuery(async () => {
    if (!profile) return null;
    const db = getDB();
    const [garments, outfits, entries, outbox] = await Promise.all([
      db.garments.where('userId').equals(profile.userId).count(),
      db.outfits.where('userId').equals(profile.userId).count(),
      db.calendarEntries.where('userId').equals(profile.userId).count(),
      db.outbox.count(),
    ]);
    return { garments, outfits, entries, outbox };
  }, [profile?.userId]);

  if (!profile) return null;

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-heading text-2xl">Perfil</h1>

      <section className="card-surface flex items-center gap-4 p-5">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-xl font-bold text-primary">
          {profile.displayName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-heading text-lg">{profile.displayName}</p>
          <p className="truncate text-sm text-text-secondary">{profile.email}</p>
        </div>
      </section>

      {remoteExpired && (
        <section className="card-surface border-warning/40 p-4" role="alert">
          <p className="text-sm font-semibold text-warning">Sesión remota expirada</p>
          <p className="mt-1 text-sm text-text-secondary">
            Tus datos locales están a salvo y seguirán disponibles sin conexión. Vuelve a
            iniciar sesión para reanudar la sincronización.
          </p>
          <Button className="mt-3" size="md" onClick={() => router.push('/login')}>
            Iniciar sesión de nuevo
          </Button>
        </section>
      )}

      <section className="card-surface p-5">
        <h2 className="mb-3 font-heading text-base">Tus datos en este dispositivo</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <Count label="Prendas" value={counts?.garments ?? 0} />
          <Count label="Outfits" value={counts?.outfits ?? 0} />
          <Count label="Entradas" value={counts?.entries ?? 0} />
        </dl>
        <div className="mt-4 rounded-xl bg-surface-alt p-3 text-sm text-text-secondary">
          <p className="font-semibold text-text-primary">
            {online ? 'Con conexión' : 'Sin conexión'} ·{' '}
            {stats.pending + stats.failed === 0
              ? 'Todo sincronizado'
              : `${stats.pending + stats.failed} cambios pendientes`}
          </p>
          <p className="mt-1 text-xs">
            {stats.lastSyncedAt
              ? `Última sincronización: ${new Date(stats.lastSyncedAt).toLocaleString('es')}`
              : 'Sin sincronizar todavía'}
          </p>
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-3 font-heading text-base">Compartir</h2>
        <p className="text-sm text-text-secondary">
          Invita a otras personas a ver o gestionar tu armario completo.
        </p>
        <Link
          href="/sharing"
          className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-hover"
        >
          <ShareIcon size={16} />
          Gestionar accesos
        </Link>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-3 font-heading text-base">Ajustes</h2>
        <div className="rounded-xl bg-surface-alt p-3">
          <p className="text-sm font-medium">Notas</p>
          <p className="mt-1 text-xs text-text-secondary">
            Las fotos se procesan en tu dispositivo (WebP ≤ 1080px) antes de guardarse.
            La sincronización ocurre automáticamente al recuperar conexión.
          </p>
        </div>
      </section>

      <Button variant="secondary" className="w-full" onClick={handleLogout} data-testid="logout">
        Cerrar sesión
      </Button>
      <p className="pb-4 text-center text-xs text-text-muted">
        Los datos de este dispositivo se conservan al cerrar sesión.
      </p>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-alt py-3">
      <dt className="font-heading text-xl">{value}</dt>
      <dd className="text-xs text-text-secondary">{label}</dd>
    </div>
  );
}
