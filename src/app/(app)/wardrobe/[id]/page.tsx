'use client';

/**
 * Detalle de prenda: foto protagonista, atributos y acciones
 * (editar, clonar, archivar, eliminar, compartir).
 */
import { useRouter, useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession, useSync } from '@/components/providers';
import { getDB } from '@/lib/local/db';
import { archiveGarment, cloneGarment, deleteGarment } from '@/lib/local/repositories';
import { CATEGORY_LABELS, COLOR_HEX, COLOR_LABELS } from '@/lib/domain/constants';
import { GarmentPhoto } from '@/components/garment-photo';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui';
import { FavoriteButton } from '@/components/favorite-button';
import { StatusToast } from '@/components/status-toast';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CopyIcon,
  PencilIcon,
  ShareIcon,
  TrashIcon,
} from '@/components/icons';

export default function GarmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { profile } = useSession();
  const { online } = useSync();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const dismissShareStatus = useCallback(() => setShareStatus(null), []);

  const garment = useLiveQuery(
    async () => (params?.id ? getDB().garments.get(params.id) : undefined),
    [params?.id],
  );

  if (!profile) return null;

  if (garment === undefined) {
    return (
      <div className="card-surface mx-auto aspect-[4/5] max-w-sm animate-pulse" aria-label="Cargando" />
    );
  }
  if (!garment || garment.deletedAt) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <p className="text-text-secondary">Esta prenda ya no existe.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push('/wardrobe')}>
          Volver al armario
        </Button>
      </div>
    );
  }

  const categoryLabel =
    CATEGORY_LABELS[garment.category] ?? garment.category;

  async function handleArchive() {
    await archiveGarment(garment!.id, !garment!.archived);
  }

  async function handleClone() {
    const clone = await cloneGarment(garment!.id);
    if (clone) router.push(`/wardrobe/${clone.id}`);
  }

  async function handleDelete() {
    await deleteGarment(garment!.id);
    router.push('/wardrobe');
  }

  async function handleShare() {
    if (!online) {
      setShareStatus('Necesitas conexión para compartir esta prenda.');
      return;
    }
    const url = `${window.location.origin}/share/garment/${garment!.shareableId}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setShareStatus('Enlace de la prenda copiado.');
    } catch {
      setShareStatus(`No se pudo copiar. Enlace: ${url}`);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <StatusToast message={shareStatus} onDismiss={dismissShareStatus} />
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/wardrobe')}
          aria-label="Volver"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
        >
          <ArrowLeftIcon size={20} />
        </button>
        <div className="flex gap-1">
          <FavoriteButton
            garmentId={garment.id}
            favorite={garment.favorite}
            className="hover:bg-primary-soft"
          />
          <button
            type="button"
            onClick={handleClone}
            aria-label="Clonar prenda"
            title="Clonar"
            data-testid="clone-garment"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <CopyIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            aria-label="Compartir prenda"
            title="Compartir"
            data-testid="share-garment"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-alt"
          >
            <ShareIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Eliminar prenda"
            title="Eliminar"
            data-testid="delete-garment"
            className="flex h-11 w-11 items-center justify-center rounded-full text-danger hover:bg-danger/10"
          >
            <TrashIcon size={20} />
          </button>
        </div>
      </div>

      <div className="card-surface overflow-hidden" data-testid="garment-detail">
        <div className="aspect-[4/3] w-full bg-surface-alt">
          <GarmentPhoto
            imageId={garment.photoId}
            alt={garment.name ?? categoryLabel}
            rounded="rounded-none"
            className="h-full w-full object-cover"
            iconSize={48}
          />
        </div>
        <div className="space-y-5 p-5">
          <div>
            <h1 className="font-heading text-2xl" data-testid="garment-name">
              {garment.name ?? 'Sin nombre'}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">{categoryLabel}</p>
            {garment.archived && (
              <span className="mt-2 inline-block rounded-full bg-surface-alt px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Archivada
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {garment.brand && (
              <Detail label="Marca" value={garment.brand} />
            )}
            {garment.washingInstructions && (
              <Detail label="Cuidados" value={garment.washingInstructions} />
            )}
          </dl>

          {garment.colors.length > 0 && (
            <div>
              <dt className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Colores
              </dt>
              <div className="flex flex-wrap gap-2">
                {garment.colors.map((color) => (
                  <span
                    key={color}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-secondary"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ background: COLOR_HEX[color] ?? '#A79F99' }}
                      aria-hidden
                    />
                    {COLOR_LABELS[color] ?? color}
                  </span>
                ))}
              </div>
            </div>
          )}

          {garment.notes && (
            <div>
              <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Notas
              </dt>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                {garment.notes}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => router.push(`/wardrobe/${garment.id}/edit`)}
              data-testid="edit-garment"
            >
              <PencilIcon size={18} />
              Editar
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={handleArchive}
              data-testid="archive-garment"
            >
              <ArchiveIcon size={18} />
              {garment.archived ? 'Desarchivar' : 'Archivar'}
            </Button>
          </div>

        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar prenda?"
        message={`"${garment.name ?? 'Esta prenda'}" se eliminará de tu armario. Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-text-primary">{value}</dd>
    </div>
  );
}
