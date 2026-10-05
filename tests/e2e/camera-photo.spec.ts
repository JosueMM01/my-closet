import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test('un único control usa el selector nativo y no sube el borrador', async ({ page }) => {
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
  const photoChooser = page.waitForEvent('filechooser');
  await page.getByTestId('photo-upload').click();
  const chooser = await photoChooser;
  expect(await chooser.element().getAttribute('capture')).toBeNull();
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
  // No certifica hardware físico ni el menú del sistema operativo.
  await chooser.setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();

  const replacementChooser = page.waitForEvent('filechooser');
  await page.getByTestId('photo-upload').click();
  await (await replacementChooser).setFiles(path.resolve('public/item-jacket.jpg'));
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  await expect(page.getByTestId('photo-upload')).toBeEnabled();
  expect(imageWrites).toEqual([]);
});
