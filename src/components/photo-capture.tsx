'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, XIcon } from './icons';
import { Button } from './ui';

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'No se permitió usar la cámara. Puedes habilitar el permiso del navegador o elegir una foto de la galería.';
  }
  if (name === 'NotFoundError') return 'No se encontró una cámara. Puedes elegir una foto de la galería.';
  if (name === 'NotReadableError') return 'No se pudo abrir la cámara; puede estar ocupada por otra app. Puedes usar la galería.';
  return 'No se pudo iniciar la cámara. Puedes elegir una foto de la galería.';
}

/** Se monta solo tras pulsar el control de foto. Nunca transmite video ni solicita audio. */
export function PhotoCapture({ onPhoto, onGallery, onClose }: {
  onPhoto: (file: File) => void;
  onGallery: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('La cámara no está disponible aquí. Abre la app con HTTPS o elige una foto de la galería.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        // El permiso puede resolverse después de cerrar el modal o elegir galería.
        if (generation !== generationRef.current || !videoRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      } catch (caught) {
        if (generation !== generationRef.current) return;
        stopCamera();
        setReady(false);
        setError(cameraError(caught));
      }
    }
    void start();
    function pause() {
      if (document.visibilityState !== 'hidden') return;
      stopCamera();
      setReady(false);
      setError('La cámara se pausó al salir de la app. Puedes reabrirla o elegir una foto.');
    }
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', stopCamera);
    return () => {
      stopCamera();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', stopCamera);
    };
  }, [attempt, stopCamera]);

  function close() {
    stopCamera();
    dialogRef.current?.close();
    onClose();
  }

  function gallery() {
    stopCamera();
    // Cerrar sincrónicamente evita que el dialog deje inerte el input de archivos.
    dialogRef.current?.close();
    onGallery();
  }

  async function capture() {
    const video = videoRef.current;
    if (!ready || capturing || !video?.videoWidth || !video.videoHeight) return;
    const generation = generationRef.current;
    setCapturing(true);
    try {
      const ratio = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
      canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas no disponible');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('No se pudo capturar la imagen')),
        'image/jpeg', 0.92,
      ));
      if (generation !== generationRef.current) return;
      const file = new File([blob], 'foto-camara.jpg', { type: blob.type });
      stopCamera();
      dialogRef.current?.close();
      onPhoto(file);
    } catch {
      if (generation === generationRef.current) setError('No se pudo tomar la foto. Intenta de nuevo o elige una de la galería.');
    } finally {
      if (generation === generationRef.current) setCapturing(false);
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="photo-capture-title"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-3xl border border-border bg-surface p-4 text-text-primary shadow-soft backdrop:bg-black/60"
      onCancel={event => { event.preventDefault(); close(); }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="photo-capture-title" className="text-lg font-semibold">Foto de la prenda</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Cerrar cámara" onClick={close}><XIcon /></Button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label="Vista previa de la cámara"
        className="max-h-[55dvh] w-full rounded-2xl bg-black object-contain"
        onLoadedData={() => { if (streamRef.current) setReady(true); }} />
      <p className="my-3 text-sm text-text-secondary" role={error ? 'alert' : 'status'}>
        {error ?? (ready ? 'Encuadra la prenda. La fotografía se procesa solo en este dispositivo.' : 'Esperando acceso a la cámara… También puedes elegir una foto existente.')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button type="button" variant="secondary" onClick={gallery}>Elegir de la galería</Button>
        <Button type="button" disabled={!ready || capturing} onClick={() => void capture()}><CameraIcon /> Tomar foto</Button>
        {error ? <Button type="button" variant="ghost" onClick={() => { setError(null); setReady(false); setCapturing(false); setAttempt(value => value + 1); }}>Reabrir cámara</Button> : null}
      </div>
    </dialog>
  );
}
