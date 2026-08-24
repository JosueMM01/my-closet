'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { closeDecodedImage, decodeImageFile } from '@/lib/images/processor';
import { XIcon } from './icons';

export type ImageEditorMode = 'erase' | 'restore';

export interface ImageEditorUpdate {
  blob: Blob;
  width: number;
  height: number;
}

interface ImageEditorProps {
  imageId: string;
  resultBlob: Blob;
  originalBlob: Blob;
  width: number;
  height: number;
  onCommit: (update: ImageEditorUpdate) => Promise<void>;
  onClose: () => void;
}

function canvasPoint(
  canvas: HTMLCanvasElement,
  event: ReactPointerEvent<HTMLCanvasElement>,
): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
  };
}

export function ImageEditor({
  imageId,
  resultBlob,
  originalBlob,
  width,
  height,
  onCommit,
  onClose,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const futureRef = useRef<ImageData[]>([]);
  const paintingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<ImageEditorMode>('erase');
  const [brushSize, setBrushSize] = useState(48);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const refreshHistoryState = useCallback((): void => {
    setHistoryState({
      canUndo: historyRef.current.length > 1,
      canRedo: futureRef.current.length > 0,
    });
  }, []);

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    historyRef.current = [];
    futureRef.current = [];
    refreshHistoryState();
    setReady(false);
    setDirty(false);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;

    const load = async () => {
      try {
        const [result, original] = await Promise.all([
          decodeImageFile(resultBlob),
          decodeImageFile(originalBlob),
        ]);
        if (!active) {
          closeDecodedImage(result.source);
          closeDecodedImage(original.source);
          return;
        }

        context.clearRect(0, 0, width, height);
        context.drawImage(result.source, 0, 0, width, height);
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        const sourceContext = sourceCanvas.getContext('2d');
        if (!sourceContext) throw new Error('No se pudo preparar la imagen original');
        sourceContext.drawImage(original.source, 0, 0, width, height);
        originalCanvasRef.current = sourceCanvas;
        historyRef.current = [context.getImageData(0, 0, width, height)];
        refreshHistoryState();
        setReady(true);
        closeDecodedImage(result.source);
        closeDecodedImage(original.source);
      } catch {
        setReady(false);
      }
    };
    void load();
    return () => {
      active = false;
      originalCanvasRef.current = null;
    };
  }, [imageId, resultBlob, originalBlob, width, height, refreshHistoryState]);

  function saveSnapshot(): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    historyRef.current = [
      ...historyRef.current.slice(-9),
      context.getImageData(0, 0, canvas.width, canvas.height),
    ];
    futureRef.current = [];
    refreshHistoryState();
  }

  function paintAt(point: { x: number; y: number }): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !ready) return;
    const radius = brushSize / 2;
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (mode === 'erase') {
      context.globalCompositeOperation = 'destination-out';
      context.fill();
    } else {
      const sourceCanvas = originalCanvasRef.current;
      if (sourceCanvas) {
        context.clip();
        context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
      }
    }
    context.restore();
    setDirty(true);
  }

  function paintLine(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, brushSize / 4)));
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      paintAt({
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      });
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!ready || saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    saveSnapshot();
    paintingRef.current = true;
    const point = canvasPoint(event.currentTarget, event);
    lastPointRef.current = point;
    paintAt(point);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!paintingRef.current) return;
    const point = canvasPoint(event.currentTarget, event);
    const previous = lastPointRef.current ?? point;
    paintLine(previous, point);
    lastPointRef.current = point;
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function restoreSnapshot(snapshot: ImageData | undefined): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !snapshot) return;
    context.putImageData(snapshot, 0, 0);
    setDirty(true);
  }

  function undo(): void {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current.pop();
    if (current) futureRef.current.push(current);
    refreshHistoryState();
    restoreSnapshot(historyRef.current.at(-1));
  }

  function redo(): void {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(next);
    refreshHistoryState();
    restoreSnapshot(next);
  }

  const commit = useCallback(async (): Promise<boolean> => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return false;
    if (!dirty) return true;
    setSaving(true);
    setSaveError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error('No se pudo guardar la edición')),
          'image/webp',
          0.82,
        );
      });
      await onCommit({ blob, width: canvas.width, height: canvas.height });
      setDirty(false);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo aplicar la edición');
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, onCommit, saving]);

  async function applyAndClose(): Promise<void> {
    if (await commit()) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-text-primary/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
      <section className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[2rem] border border-border bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Retoque local</p>
            <h2 id="image-editor-title" className="mt-1 font-heading text-xl">Ajustar recorte</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Borra restos del fondo o restaura una zona que el modelo recortó de más.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">Sin guardar</span> : null}
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-alt text-text-secondary transition-colors hover:bg-border" aria-label="Cancelar edición">
              <XIcon size={20} />
            </button>
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-2xl border border-border bg-[conic-gradient(#eee_25%,white_0_50%,#eee_0_75%,white_0)_0_0/18px_18px]">
        <canvas
          ref={canvasRef}
          className="block aspect-square h-auto w-full touch-none object-contain"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Lienzo para editar la transparencia de la imagen"
        />
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 text-xs text-text-muted">
            Preparando pincel…
          </div>
        ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('erase')}
          aria-pressed={mode === 'erase'}
          className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${mode === 'erase' ? 'border-primary bg-primary text-white' : 'border-border bg-surface-alt text-text-primary'}`}
        >
          Borrar
        </button>
        <button
          type="button"
          onClick={() => setMode('restore')}
          aria-pressed={mode === 'restore'}
          className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${mode === 'restore' ? 'border-primary bg-primary text-white' : 'border-border bg-surface-alt text-text-primary'}`}
        >
          Restaurar
        </button>
        </div>

        <label className="mt-4 block text-xs font-semibold text-text-secondary" htmlFor="brush-size">
        Tamaño del pincel: {brushSize}px
        <input
          id="brush-size"
          type="range"
          min="12"
          max="180"
          step="4"
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
          className="mt-2 w-full accent-primary"
        />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
          <button type="button" onClick={undo} disabled={!historyState.canUndo || saving} className="min-h-10 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-40" aria-label="Deshacer edición">Deshacer</button>
          <button type="button" onClick={redo} disabled={!historyState.canRedo || saving} className="min-h-10 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-40" aria-label="Rehacer edición">Rehacer</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-10 rounded-lg border border-border px-4 text-xs font-semibold text-text-secondary disabled:opacity-40">Cancelar</button>
            <button type="button" onClick={() => void applyAndClose()} disabled={!ready || saving} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? 'Guardando…' : 'Aplicar edición'}
            </button>
          </div>
        </div>
        {saveError ? <p role="alert" className="mt-3 text-xs text-danger">{saveError}</p> : null}
        <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
          La edición se queda en este dispositivo y no se sube hasta guardar la prenda.
        </p>
      </section>
    </div>
  );
}
