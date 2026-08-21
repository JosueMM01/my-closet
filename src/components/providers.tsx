'use client';

/**
 * Providers raíz: sesión local (perfil en IndexedDB, sin secretos),
 * estado de sincronización y arranque del Service Worker.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LocalProfile, SyncStats } from '@/lib/domain/types';
import { getLocalProfile, setLocalProfile } from '@/lib/local/kv';
import { sessionResponseSchema } from '@/lib/domain/validation';
import {
  isSyncRunning,
  readSyncStats,
  startSyncEngine,
  subscribeSyncState,
} from '@/lib/local/sync-engine';

interface SessionContextValue {
  profile: LocalProfile | null;
  loading: boolean;
  /** Sesión remota inválida pero datos locales conservados. */
  remoteExpired: boolean;
  setRemoteExpired: (value: boolean) => void;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession fuera de SessionProvider');
  return context;
}

interface SyncContextValue {
  stats: SyncStats;
  running: boolean;
  online: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function toLocalProfile(
  profile: Extract<
    ReturnType<typeof sessionResponseSchema.parse>,
    { authenticated: true }
  >['profile'],
): LocalProfile {
  return {
    userId: profile.userId,
    email: profile.email,
    displayName: profile.displayName,
    createdAt: profile.createdAt,
    role: profile.role,
    profileImageId: profile.profileImageId,
  };
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync fuera de SyncProvider');
  return context;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [remoteExpired, setRemoteExpired] = useState(false);
  const [stats, setStats] = useState<SyncStats>({
    pending: 0,
    syncing: 0,
    failed: 0,
    lastSyncedAt: null,
  });
  const [running, setRunning] = useState(false);
  const [online, setOnline] = useState(true);

  const refreshProfile = useCallback(async () => {
    setProfile(await getLocalProfile());
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      let loaded = await getLocalProfile();
      if (!loaded && navigator.onLine) {
        try {
          const response = await fetch('/api/auth/session', {
            headers: { 'x-requested-with': 'my-closet' },
            cache: 'no-store',
          });
          if (response.ok) {
            const parsed = sessionResponseSchema.safeParse(await response.json());
            if (parsed.success && parsed.data.authenticated) {
              await setLocalProfile(toLocalProfile(parsed.data.profile));
              // IndexedDB sigue siendo la fuente que alimenta a la UI.
              loaded = await getLocalProfile();
            }
          }
        } catch {
          // Sin red: un perfil local ausente equivale a sesión no disponible.
        }
      }
      if (cancelled) return;
      setProfile(loaded);
      setLoading(false);
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Arranque del sync engine + suscripción a su estado.
  useEffect(() => {
    startSyncEngine();
    const refreshStats = () => {
      if (profile) {
        void readSyncStats(profile.userId).then(setStats);
      } else {
        setStats({ pending: 0, syncing: 0, failed: 0, lastSyncedAt: null });
      }
      setRunning(isSyncRunning());
    };
    refreshStats();
    const unsubscribe = subscribeSyncState(refreshStats);
    // Re-leer estadísticas al volver a escribir datos (outbox cambia).
    const interval = setInterval(refreshStats, 2_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [profile]);

  // Estado online/offline para UX (no como error).
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Sesión remota: si el servidor responde 401 con perfil local, marcar
  // expirada (los datos NUNCA se borran; solo se pide re-autenticación).
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch('/api/auth/session', {
          headers: { 'x-requested-with': 'my-closet' },
        });
        if (cancelled) return;
        if (!response.ok) return;
        const parsed = sessionResponseSchema.safeParse(await response.json());
        if (!parsed.success || cancelled) return;
        setRemoteExpired(!parsed.data.authenticated);
        if (parsed.data.authenticated) {
          const remoteProfile = toLocalProfile(parsed.data.profile);
          const changed = JSON.stringify(remoteProfile) !== JSON.stringify(profile);
          if (changed) {
            await setLocalProfile(remoteProfile);
            if (!cancelled) setProfile(remoteProfile);
          }
        }
      } catch {
        // Sin conexión: estado normal, no es error.
      }
    };
    void check();
    const interval = setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [profile]);

  const sessionValue = useMemo<SessionContextValue>(
    () => ({ profile, loading, remoteExpired, setRemoteExpired, refreshProfile }),
    [profile, loading, remoteExpired, refreshProfile],
  );
  const syncValue = useMemo<SyncContextValue>(() => ({ stats, running, online }), [stats, running, online]);

  return (
    <SessionContext.Provider value={sessionValue}>
      <SyncContext.Provider value={syncValue}>{children}</SyncContext.Provider>
    </SessionContext.Provider>
  );
}
