import { expect, test } from '@playwright/test';
import { createGarment, registerAndLogin, waitForHydration } from './helpers';

test.describe('Conjuntos y calendario', () => {
  test('crear conjunto en el editor', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Camisa blanca');

    await page.goto('/outfits');
    await waitForHydration(page);
    await page.getByTestId('new-outfit').click();
    await page.getByLabel('Nombre', { exact: false }).fill('Oficina');
    await page.getByRole('button', { name: 'Partes de arriba' }).first().click();
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Oficina');
    await expect(page.getByTestId('outfit-detail')).toContainText('Camisa blanca');
  });

  test('el conjunto aparece en la lista', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Pantalón beige', 'Partes de abajo');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: false }).fill('Casual');
    await page.getByRole('button', { name: 'Partes de abajo' }).first().click();
    await page.getByTestId('save-outfit').click();
    await page.goto('/outfits');
    await waitForHydration(page);
    await expect(page.getByTestId('outfit-card').first()).toContainText('Casual');
  });

  test('programar un conjunto crea una entrada de calendario', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Vestido floral', 'Vestidos');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.goto(`/outfits/new?date=${tomorrow}`);
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: false }).fill('Boda');
    await page.getByRole('button', { name: 'Vestidos' }).first().click();
    await expect(page.getByLabel('Programar en el calendario', { exact: false })).toHaveValue(tomorrow);
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Boda');

    await page.goto('/calendar');
    await waitForHydration(page);
    // Si mañana cae en el mes siguiente, navegar antes de elegir el día.
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (tomorrowDate.getMonth() !== new Date().getMonth()) {
      await page.getByRole('button', { name: 'Mes siguiente' }).click();
    }
    await page.locator(`[data-testid="calendar-day"][data-date="${tomorrow}"]`).click();
    await expect(page.getByTestId('day-entries')).toContainText('Boda');
  });

  test('marcar conjunto como vestido', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Chaqueta vaquera', 'Abrigos');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: false }).fill('Finde');
    await page.getByRole('button', { name: 'Abrigos' }).first().click();
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel('Programar en el calendario', { exact: false }).fill(today);
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Finde');

    await page.goto('/calendar');
    await waitForHydration(page);
    await page.getByTestId('toggle-worn').first().click();
    await expect(page.getByTestId('toggle-worn').first()).toContainText('Vestido');
  });

  test('quitar conjunto del calendario', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Falda negra', 'Partes de abajo');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: false }).fill('Cena');
    await page.getByRole('button', { name: 'Partes de abajo' }).first().click();
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel('Programar en el calendario', { exact: false }).fill(today);
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Cena');

    await page.goto('/calendar');
    await waitForHydration(page);
    await expect(page.getByTestId('day-entries')).toContainText('Cena');
    await page.getByRole('button', { name: 'Quitar del calendario' }).click();
    await page.getByRole('button', { name: 'Quitar', exact: true }).click();
    await expect(page.getByTestId('day-entries')).toHaveCount(0);
  });
});
