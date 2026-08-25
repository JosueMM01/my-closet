'use client';

import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '@/lib/local/db';

interface OfflineRouteCacheProps {
  userId: string;
}

/**
 * Pide al Service Worker guardar los documentos de las rutas dinámicas cuyos
 * datos ya existen en IndexedDB. Así una URL de detalle puede recargarse sin
 * red; el contenido continúa leyéndose exclusivamente desde IndexedDB.
 */
export function OfflineRouteCache({ userId }: OfflineRouteCacheProps) {
  const entityIds = useLiveQuery(async () => {
    const db = getDB();
    const [garments, outfits] = await Promise.all([
      db.garments.where('userId').equals(userId).toArray(),
      db.outfits.where('userId').equals(userId).toArray(),
    ]);
    return {
      garments: garments.filter((item) => !item.deletedAt).map((item) => item.id),
      outfits: outfits.filter((item) => !item.deletedAt).map((item) => item.id),
    };
  }, [userId]);

  const routes = useMemo(() => {
    if (!entityIds) return [];
    return [
      ...entityIds.garments.flatMap((id) => [`/wardrobe/${id}`, `/wardrobe/${id}/edit`]),
      ...entityIds.outfits.map((id) => `/outfits/${id}`),
    ];
  }, [entityIds]);

  useEffect(() => {
    if (!navigator.onLine || routes.length === 0 || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: 'CACHE_OFFLINE_ROUTES', routes });
    });
  }, [routes]);

  return null;
}
