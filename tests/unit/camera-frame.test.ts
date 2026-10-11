import { expect, it } from 'vitest';
import { cameraFrame } from '@/lib/images/camera-frame';

it('encuadre vertical desde una cámara horizontal coincide con el visor sin estirar', () => {
  const frame = cameraFrame(1920, 1080, 360, 800);
  expect(frame.outputHeight).toBeGreaterThan(frame.outputWidth);
  expect(frame.width / frame.height).toBeCloseTo(360 / 800);
  expect(frame.x).toBeGreaterThan(0);
  expect(frame.y).toBe(0);
  expect(frame.outputHeight).toBe(1080);
});
it('conserva todo el cuadro cuando la cámara entrega la proporción correcta', () => {
  expect(cameraFrame(720, 1280, 360, 640)).toMatchObject({ x: 0, y: 0, width: 720, height: 1280 });
});
it('horizontal recorta solo arriba/abajo y no amplía imágenes pequeñas', () => {
  const frame = cameraFrame(300, 400, 800, 360);
  expect(frame.x).toBe(0);
  expect(frame.y).toBeGreaterThan(0);
  expect(frame.outputWidth).toBe(300);
});
it.each([0, -1, NaN, Infinity])('rechaza dimensiones inválidas %s', value => {
  expect(() => cameraFrame(value, 100, 100, 100)).toThrow();
});
