import { expect, test } from '@playwright/test';
import { createGarment, registerAndLogin, waitForHydration } from './helpers';

test.describe('Outfits y calendario', () => {
  test('crear outfit en el builder', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Camisa blanca');

    await page.goto('/outfits');
    await waitForHydration(page);
    await page.getByTestId('new-outfit').click();
    await page.getByLabel('Nombre', { exact: true }).fill('Oficina');
    await page.getByRole('button', { name: 'Partes de arriba' }).first().click();
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Oficina');
    await expect(page.getByTestId('outfit-detail')).toContainText('Camisa blanca');
  });

  test('outfit aparece en la lista', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Pantalón beige', 'Partes de abajo');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Casual');
    await page.getByRole('button', { name: 'Partes de abajo' }).first().click();
    await page.getByTestId('save-outfit').click();
    await page.goto('/outfits');
    await waitForHydration(page);
    await expect(page.getByTestId('outfit-card').first()).toContainText('Casual');
  });

  test('programar outfit crea entrada de calendario', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Vestido floral', 'Vestidos');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Boda');
    await page.getByRole('button', { name: 'Vestidos' }).first().click();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel('Programar en el calendario', { exact: false }).fill(tomorrow);
    await page.getByTestId('save-outfit').click();
    await expect(page.getByTestId('outfit-name')).toContainText('Boda');

    await page.goto('/calendar');
    await waitForHydration(page);
    // El día seleccionado por defecto es hoy; el outfit es para mañana
    // (que puede caer en la semana siguiente).
    const weekday = new Date(Date.now() + 24 * 60 * 60 * 1000).getDay();
    if (weekday === 1) {
      await page.getByRole('button', { name: 'Semana siguiente' }).click();
    }
    await page.locator(`[data-testid="calendar-day"][data-date="${tomorrow}"]`).click();
    await expect(page.getByTestId('day-entries')).toContainText('Boda');
  });

  test('marcar outfit como vestido', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Chaqueta vaquera', 'Abrigos');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Finde');
    await page.getByRole('button', { name: 'Abrigos' }).first().click();
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel('Programar en el calendario', { exact: false }).fill(today);
    await page.getByTestId('save-outfit').click();

    await page.goto('/calendar');
    await waitForHydration(page);
    await page.getByTestId('toggle-worn').first().click();
    await expect(page.getByTestId('toggle-worn').first()).toContainText('Vestido');
  });

  test('quitar outfit del calendario', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Falda negra', 'Partes de abajo');
    await page.goto('/outfits/new');
    await waitForHydration(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Cena');
    await page.getByRole('button', { name: 'Partes de abajo' }).first().click();
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel('Programar en el calendario', { exact: false }).fill(today);
    await page.getByTestId('save-outfit').click();

    await page.goto('/calendar');
    await waitForHydration(page);
    await expect(page.getByTestId('day-entries')).toContainText('Cena');
    await page.getByRole('button', { name: 'Quitar del calendario' }).click();
    await page.getByRole('button', { name: 'Quitar', exact: true }).click();
    await expect(page.getByTestId('day-entries')).toHaveCount(0);
  });
});
