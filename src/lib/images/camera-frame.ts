/** El recorte coincide con object-fit: cover; nunca estira ni aumenta resolución. */
export function cameraFrame(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number) {
  if (![sourceWidth, sourceHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Dimensiones de cámara inválidas');
  }
  const aspect = frameWidth / frameHeight;
  const width = Math.min(sourceWidth, sourceHeight * aspect);
  const height = Math.min(sourceHeight, sourceWidth / aspect);
  const scale = Math.min(1, 1080 / Math.max(width, height));
  return {
    x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height,
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  };
}
