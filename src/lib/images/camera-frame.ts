/** Conserva todo el sensor y reduce como máximo el lado mayor a 1080 px. */
export function cameraFrame(sourceWidth: number, sourceHeight: number) {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Dimensiones de cámara inválidas');
  }
  const scale = Math.min(1, 1080 / Math.max(sourceWidth, sourceHeight));
  return {
    outputWidth: Math.max(1, Math.round(sourceWidth * scale)),
    outputHeight: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
