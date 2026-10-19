import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

function seedEmailConfirmation(email: string, newEmail: string): string {
  // El correo capturado vive en el proceso Next. Sembrar un codigo sintetico
  // evita exponer un endpoint de pruebas o enviar correo real desde E2E.
  const db = new Database(path.resolve('data/my-closet-e2e.db'), { fileMustExist: true });
  const token = randomBytes(32).toString('base64url');
  try {
    const changed = db.prepare(`UPDATE email_change_tokens SET token_hash = ?
      WHERE user_id = (SELECT id FROM users WHERE email = ?) AND new_email = ?`)
      .run(createHash('sha256').update(token).digest('hex'), email, newEmail);
    expect(changed.changes).toBe(1);
    return token;
  } finally { db.close(); }
}

test.describe('Perfil', () => {
  test('verifica el nuevo correo, actualiza el perfil y conserva acceso con la nueva identidad', async ({ page }) => {
    test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'La siembra de correo usa exclusivamente SQLite E2E local');
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
    const token = seedEmailConfirmation(originalEmail, email);
    await page.getByLabel('Código de verificación', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Confirmar nuevo correo' }).click();
    await expect(page.getByText('Correo verificado y actualizado. Las otras sesiones se cerraron.')).toBeVisible();
    await expect(page.getByLabel('Correo nuevo')).toHaveValue(email);

    await page.getByTestId('logout').click();
    await page.getByLabel('Correo electrónico').fill(email);
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
