import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test('la invitación de armario se configura en un modal', async ({ page }) => {
  await registerAndLogin(page, 'Prueba Compartir');
  await page.goto('/sharing');
  await waitForHydration(page);
  await expect(page.getByLabel('Correo de la persona')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nueva invitación' }).click();
  const modal = page.getByRole('dialog', { name: 'Nueva invitación' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Gestionar', exact: true }).click();
  await expect(modal.getByText(/ver y gestionar/)).toBeVisible();
  await modal.getByLabel('Correo de la persona').fill('correo-invalido');
  await modal.getByRole('button', { name: 'Crear invitación' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});
