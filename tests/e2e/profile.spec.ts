import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test.describe('Perfil', () => {
  test('actualiza nombre y contraseña, y conserva el correo hasta verificar el nuevo', async ({ page }) => {
    await registerAndLogin(page, 'Perfil Inicial');
    await page.goto('/profile');
    await waitForHydration(page);

    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Perfil Inicial');
    await expect(page.getByLabel('Correo nuevo')).toHaveValue(/@test\.local$/);
    const originalEmail = await page.getByLabel('Correo nuevo').inputValue();

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
    await emailForm.getByRole('button', { name: 'Enviar código de verificación' }).click();
    await expect(page.getByText(`Código enviado a ${email}. Tu correo actual no ha cambiado.`)).toBeVisible();
    await page.getByLabel('Código de verificación', { exact: true }).fill('A'.repeat(43));
    await page.getByRole('button', { name: 'Confirmar nuevo correo' }).click();
    await expect(page.getByText('El código no es válido o ha vencido. Solicita uno nuevo.')).toBeVisible();

    await page.getByTestId('logout').click();
    await page.getByLabel('Correo electrónico').fill(originalEmail);
    await page.getByLabel('Contraseña', { exact: true }).fill('contrasena-nueva');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, Perfil');
  });

  test('procesa y sube la foto sin solicitar modelos ONNX', async ({ page }) => {
    const modelRequests: string[] = [];
    let imageUploads = 0;
    page.on('request', (request) => {
      const url = request.url().toLowerCase();
      if (url.includes('imgly') || url.includes('/vendor/background-removal/') || url.includes('.onnx') || url.includes('isnet')) {
        modelRequests.push(url);
      }
    });
    await page.route('**/api/images', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      imageUploads += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.continue();
    });

    await registerAndLogin(page, 'Foto Perfil');
    await page.goto('/profile');
    await waitForHydration(page);
    await page
      .getByLabel('Elegir foto de perfil')
      .setInputFiles(path.resolve('public/item-bag.jpg'));

    await expect(page.getByText('Foto de perfil actualizada.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByAltText('Foto de perfil de Foto Perfil')).toBeVisible();
    expect(imageUploads).toBe(1);
    expect(modelRequests).toEqual([]);
  });
});
