import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test.describe('Eliminacion de fondo local', () => {
  test('genera un WebP transparente sin enviar la foto a terceros', async ({ page }, testInfo) => {
    test.skip(
      process.env.RUN_BACKGROUND_MODEL_E2E !== '1' || testInfo.project.name !== 'chromium-desktop',
      'La prueba del modelo real es lenta y se ejecuta de forma explicita.',
    );
    test.setTimeout(10 * 60_000);

    const externalRequests: string[] = [];
    const browserErrors: string[] = [];
    const imageSignRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== 'localhost') {
        externalRequests.push(url.href);
      }
      if (url.pathname === '/api/images/sign') imageSignRequests.push(url.href);
    });
    page.on('requestfailed', (request) => {
      browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'fallo de red'}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await registerAndLogin(page);
    await page.goto('/wardrobe/new');
    await waitForHydration(page);

    await page
      .locator('input[type="file"]')
      .setInputFiles(path.resolve('public/item-jacket.jpg'));

    const preview = page.getByTestId('photo-preview');
    const processingError = page.locator('form p[role="alert"]');
    await Promise.race([
      preview.waitFor({ state: 'visible', timeout: 9 * 60_000 }),
      processingError.waitFor({ state: 'visible', timeout: 9 * 60_000 }).then(async () => {
        throw new Error(await processingError.innerText());
      }),
    ]).catch(async (error: unknown) => {
      await testInfo.attach('errores-del-navegador', {
        body: browserErrors.join('\n') || 'Sin errores capturados',
        contentType: 'text/plain',
      });
      throw error;
    });
    await expect(processingError).toHaveCount(0);
    const editor = page.getByRole('region', { name: 'Ajustar recorte' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Borrar', exact: true })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Restaurar', exact: true })).toBeVisible();
    await expect(editor.getByLabel('Tamaño del pincel: 48px')).toBeVisible();
    expect(imageSignRequests).toEqual([]);

    await editor.locator('canvas').click({ position: { x: 8, y: 8 } });
    await expect(editor.getByText('Sin guardar')).toBeVisible();
    await editor.getByRole('button', { name: 'Aplicar edición' }).click();
    await expect(editor.getByText('Sin guardar')).toHaveCount(0);
    expect(externalRequests).toEqual([]);

    const hasTransparency = await preview.evaluate(async (image) => {
      const source = image.getAttribute('src');
      if (!source) return false;
      const blob = await fetch(source).then((response) => response.blob());
      if (blob.type !== 'image/webp') return false;
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 255) return true;
      }
      return false;
    });

    expect(hasTransparency).toBe(true);
  });
});
