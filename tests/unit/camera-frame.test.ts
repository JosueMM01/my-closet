import { expect, it } from 'vitest';
import { cameraFrame } from '@/lib/images/camera-frame';

it('conserva toda la escena horizontal aunque el visor sea vertical', () => {
  expect(cameraFrame(1920, 1080)).toEqual({ outputWidth: 1080, outputHeight: 608 });
});
it('conserva todo el cuadro en proporciones ideales portrait y landscape', () => {
  expect(cameraFrame(720, 960)).toEqual({ outputWidth: 720, outputHeight: 960 });
  expect(cameraFrame(1280, 960)).toEqual({ outputWidth: 1080, outputHeight: 810 });
});
it('no amplía imágenes pequeñas', () => {
  expect(cameraFrame(300, 400)).toEqual({ outputWidth: 300, outputHeight: 400 });
});
it.each([0, -1, NaN, Infinity])('rechaza dimensiones inválidas %s', value => {
  expect(() => cameraFrame(value, 100)).toThrow();
  expect(() => cameraFrame(100, value)).toThrow();
});
