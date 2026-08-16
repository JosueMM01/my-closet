import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGarment, registerAndLogin, waitForHydration } from './helpers';

const SHOT_DIR = join(process.cwd(), 'tests', 'e2e', 'screenshots');

/**
 * Capturas de verificación visual en múltiples tamaños.
 * Revisadas manualmente contra ui-reference (ver docs/TESTING.md).
 */
test.describe('Capturas visuales', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'login.png'), fullPage: true });
  });

  test('home vacío', async ({ page }) => {
    await registerAndLogin(page);
    await expect(page.getByTestId('home-greeting')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'home-empty.png'), fullPage: true });
  });

  test('home con datos + armario + detalle', async ({ page }) => {
    // Recorrido largo con 3 prendas + 7 capturas: margen amplio en móvil.
    test.setTimeout(120_000);
    await registerAndLogin(page);
    await createGarment(page, 'Blusa de lino', 'Partes de arriba');
    await createGarment(page, 'Vestido midi', 'Vestidos');
    await createGarment(page, 'Botines', 'Calzado');

    await page.goto('/');
    await waitForHydration(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'home.png'), fullPage: true });

    await page.goto('/wardrobe');
    await waitForHydration(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'wardrobe.png'), fullPage: true });

    await page.getByTestId('garment-card').first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'garment-detail.png'), fullPage: true });

    await page.goto('/wardrobe/new');
    await waitForHydration(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'add-garment.png'), fullPage: true });

    await page.goto('/outfits');
    await waitForHydration(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'outfits.png'), fullPage: true });

    await page.goto('/calendar');
    await waitForHydration(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, 'calendar.png'), fullPage: true });
  });
});
