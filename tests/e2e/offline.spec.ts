import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

/**
 * Flujo offline real:
 *  online → cargar app → offline → crear prenda → recargar → sigue ahí →
 *  online → sincroniza → badge "Sincronizado".
 */
test.describe('Offline-first', () => {
  test('crear y persistir sin conexión, luego sincronizar', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'solo en desktop para estado estable');
    test.fixme(browserName !== 'chromium', 'service worker requiere chromium');

    await registerAndLogin(page);

    // Visitar el armario online para que el SW lo guarde en caché runtime.
    await page.goto('/wardrobe');
    await waitForHydration(page);
    // Dar tiempo al registro/activación del service worker.
    await page.waitForTimeout(2_500);

    await context.setOffline(true);
    // Este Chromium no cambia navigator.onLine con setOffline: simular el
    // evento real que la app escucha (la red sí está bloqueada de verdad).
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByTestId('sync-badge')).toContainText('Sin conexión');

    // Crear prenda offline (el guardado es local-inmediato).
    await page.goto('/wardrobe/new');
    await waitForHydration(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await page.getByLabel('Nombre', { exact: true }).fill('Prenda offline');
    await page.getByTestId('save-garment').click();
    // Offline volvemos a la lista (shell precacheado), no al detalle dinámico.
    await expect(page.getByTestId('wardrobe-count')).toContainText('1 prenda');
    await expect(page.getByTestId('garment-card').first()).toContainText('Prenda offline');

    // Cerrar y reabrir (recargar) sin conexión: el dato sigue disponible.
    await page.reload();
    await waitForHydration(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByTestId('garment-card').first()).toContainText('Prenda offline');

    // Reconexión: el sync engine vacía la outbox.
    await context.setOffline(false);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByTestId('sync-badge')).toContainText('Sincronizado', { timeout: 30_000 });
  });
});
