'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, XIcon } from './icons';
import styles from './photo-capture.module.css';
import { cameraFrame } from '@/lib/images/camera-frame';

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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('La cámara no está disponible aquí. Abre la app con HTTPS o elige una foto de la galería.');
        return;
      }
      try {
        const portrait = window.matchMedia('(orientation: portrait)').matches;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: portrait ? 720 : 1280 },
            height: { ideal: portrait ? 1280 : 720 },
            aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 },
          },
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
      const frame = cameraFrame(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight);
      const canvas = document.createElement('canvas');
      canvas.width = frame.outputWidth;
      canvas.height = frame.outputHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas no disponible');
      context.drawImage(video, frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
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
      className={styles.dialog}
      onCancel={event => { event.preventDefault(); close(); }}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>MY CLOSET</span>
          <h2 id="photo-capture-title" className={styles.title}>Foto de la prenda</h2>
        </div>
        <button type="button" className={styles.close} aria-label="Cerrar cámara" onClick={close}><XIcon /></button>
      </header>
      <div className={styles.viewfinder}>
        <video ref={videoRef} autoPlay muted playsInline aria-label="Vista previa de la cámara"
          className={styles.video}
          onLoadedData={() => { if (streamRef.current) setReady(true); }} />
      </div>
      <footer className={styles.footer}>
        <p className={styles.status} role={error ? 'alert' : 'status'}>
          {error ?? (ready ? 'Encuadra la prenda. La fotografía se procesa solo en este dispositivo.' : 'Esperando acceso a la cámara… También puedes elegir una foto existente.')}
        </p>
        <div className={styles.controls}>
          <button type="button" className={styles.gallery} onClick={gallery}>Elegir de la galería</button>
          <button type="button" className={styles.shutter} aria-label="Tomar foto" aria-busy={capturing}
            disabled={!ready || capturing} onClick={() => void capture()}><CameraIcon /></button>
          <div className={styles.retrySlot}>
            {error ? <button type="button" className={styles.gallery} onClick={() => { setError(null); setReady(false); setCapturing(false); setAttempt(value => value + 1); }}>Reabrir cámara</button> : null}
          </div>
        </div>
      </footer>
    </dialog>
  );
}
