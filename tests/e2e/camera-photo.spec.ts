import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test('un único control conserva galería con permiso denegado y no sube el borrador', async ({ page }) => {
  await mockCamera(page, 'denied');
  await registerAndLogin(page);
  await page.goto('/wardrobe/new');
  await waitForHydration(page);
  await page.getByRole('checkbox', { name: 'Quitar el fondo automáticamente' }).uncheck();
  const imageWrites: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/images/sign' || (url.pathname.startsWith('/api/images') && request.method() === 'POST')) {
      imageWrites.push(url.pathname);
    }
  });

  await expect(page.getByRole('button', { name: 'Tomar foto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Elegir archivo', exact: true })).toHaveCount(0);
  await page.getByTestId('photo-upload').click();
  const dialog = page.getByRole('dialog', { name: 'Foto de la prenda' });
  await expect(dialog.getByRole('alert')).toContainText('No se permitió usar la cámara');
  const photoChooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Elegir de la galería' }).click();
  const chooser = await photoChooser;
  expect(await chooser.element().getAttribute('capture')).toBeNull();
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
  // No certifica hardware físico ni el menú del sistema operativo.
  await chooser.setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();

  const replacementChooser = page.waitForEvent('filechooser');
  await page.getByTestId('photo-upload').click();
  await dialog.getByRole('button', { name: 'Elegir de la galería' }).click();
  await (await replacementChooser).setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  await expect(page.getByTestId('photo-upload')).toBeEnabled();
  await page.getByTestId('photo-upload').click();
  await dialog.getByRole('button', { name: 'Cerrar cámara' }).click();
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  expect(imageWrites).toEqual([]);
});

interface CameraTestState {
  requests: number;
  constraints: MediaStreamConstraints | undefined;
  stream: MediaStream | null;
  resolve: ((stream: MediaStream) => void) | null;
  makeStream: () => MediaStream;
}
type CameraTestWindow = Window & { __cameraTest: CameraTestState };

async function mockCamera(page: Page, mode: 'ready' | 'denied' | 'pending') {
  await page.addInitScript(mode => {
    const state: CameraTestState = {
      requests: 0, constraints: undefined, stream: null, resolve: null,
      makeStream: () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas de prueba no disponible');
        context.fillStyle = '#b35b70';
        context.fillRect(0, 0, canvas.width, canvas.height);
        state.stream = canvas.captureStream(5);
        return state.stream;
      },
    };
    Object.assign(window, { __cameraTest: state });
    navigator.mediaDevices.getUserMedia = async constraints => {
      state.requests += 1;
      state.constraints = constraints;
      if (mode === 'denied') throw new DOMException('Denegado para prueba', 'NotAllowedError');
      if (mode === 'pending') return new Promise(resolve => { state.resolve = resolve; });
      return state.makeStream();
    };
  }, mode);
}

test('captura local sin audio y libera la cámara antes de procesar', async ({ page }) => {
  await mockCamera(page, 'ready');
  await registerAndLogin(page);
  await page.goto('/wardrobe/new');
  await waitForHydration(page);
  await page.getByRole('checkbox', { name: 'Quitar el fondo automáticamente' }).uncheck();
  const writes: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/images/sign' || (pathname.startsWith('/api/images') && request.method() === 'POST')) writes.push(pathname);
  });
  expect(await page.evaluate(() => (window as CameraTestWindow).__cameraTest.requests)).toBe(0);
  await page.getByTestId('photo-upload').click();
  const dialog = page.getByRole('dialog', { name: 'Foto de la prenda' });
  await expect(dialog.getByRole('button', { name: 'Tomar foto', exact: true })).toBeEnabled();
  const geometry = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(geometry).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (geometry && viewport) {
    expect(Math.abs(geometry.x + geometry.width / 2 - viewport.width / 2)).toBeLessThan(3);
    expect(geometry.width).toBeLessThanOrEqual(viewport.width - 30);
  }
  await dialog.getByRole('button', { name: 'Tomar foto', exact: true }).click();
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as CameraTestWindow).__cameraTest.constraints?.audio)).toBe(false);
  expect(await page.evaluate(() => (window as CameraTestWindow).__cameraTest.stream?.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  expect(writes).toEqual([]);
});

test('cerrar mientras se espera permiso libera también una cámara concedida tarde', async ({ page }) => {
  await mockCamera(page, 'pending');
  await registerAndLogin(page);
  await page.goto('/wardrobe/new');
  await waitForHydration(page);
  await page.getByTestId('photo-upload').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as CameraTestWindow).__cameraTest.resolve))).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const state = (window as CameraTestWindow).__cameraTest;
    state.resolve?.(state.makeStream());
  });
  await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__cameraTest.stream?.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByTestId('photo-preview')).toHaveCount(0);
});
