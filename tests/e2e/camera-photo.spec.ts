import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test('cámara y galería comparten procesamiento local sin subir un borrador', async ({ page }) => {
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

  const cameraChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Tomar foto', exact: true }).click();
  const camera = await cameraChooser;
  expect(await camera.element().getAttribute('capture')).toBe('environment');
  // No certifica el hardware físico: simula el archivo devuelto por la cámara.
  await camera.setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();

  const galleryChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Elegir archivo', exact: true }).click();
  const gallery = await galleryChooser;
  expect(await gallery.element().getAttribute('capture')).toBeNull();
  await gallery.setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tomar foto', exact: true })).toBeEnabled();
  expect(imageWrites).toEqual([]);
});
