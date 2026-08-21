import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test.describe('Perfil', () => {
  test('actualiza nombre, contraseña y correo renovando la sesión', async ({ page }) => {
    await registerAndLogin(page, 'Perfil Inicial');
    await page.goto('/profile');
    await waitForHydration(page);

    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Perfil Inicial');
    await expect(page.getByLabel('Correo nuevo')).toHaveValue(/@test\.local$/);

    const nameForm = page.locator('form').filter({ hasText: 'Nombre visible' });
    await nameForm.getByLabel('Nombre', { exact: true }).fill('Perfil Nuevo');
    await nameForm.getByRole('button', { name: 'Guardar nombre' }).click();
    await expect(page.getByText('Nombre actualizado.')).toBeVisible();

    const passwordForm = page.locator('form').filter({ hasText: 'Cambiar contraseña' });
    await passwordForm.getByLabel('Contraseña actual').fill('contrasena-segura');
    await passwordForm.getByLabel(/^Nueva contraseña/).fill('contrasena-nueva');
    await passwordForm.getByLabel('Repite la nueva contraseña').fill('contrasena-nueva');
    await passwordForm.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(page.getByText('Contraseña actualizada y sesión renovada.')).toBeVisible();

    const email = `perfil.nuevo.${Date.now()}@test.local`;
    const emailForm = page.locator('form').filter({ hasText: 'Cambiar correo' });
    await emailForm.getByLabel('Correo nuevo').fill(email);
    await emailForm.getByLabel('Contraseña actual').fill('contrasena-nueva');
    await emailForm.getByRole('button', { name: 'Cambiar correo' }).click();
    await expect(page.getByText('Correo actualizado y sesión renovada.')).toBeVisible();

    await page.getByTestId('logout').click();
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill('contrasena-nueva');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, Perfil');
  });

  test('procesa y sube la foto sin solicitar modelos ONNX', async ({ page }) => {
    const modelRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url().toLowerCase();
      if (url.includes('imgly') || url.includes('/vendor/background-removal/') || url.includes('.onnx') || url.includes('isnet')) {
        modelRequests.push(url);
      }
    });

    await registerAndLogin(page, 'Foto Perfil');
    await page.goto('/profile');
    await waitForHydration(page);
    await page
      .getByLabel('Elegir foto de perfil')
      .setInputFiles(path.resolve('public/item-bag.jpg'));

    await expect(page.getByText('Foto de perfil actualizada.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByAltText('Foto de perfil de Foto Perfil')).toBeVisible();
    expect(modelRequests).toEqual([]);
  });
});
