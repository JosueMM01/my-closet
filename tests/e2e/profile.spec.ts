import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

// Debe coincidir con AUTH_SECRET del servidor E2E en playwright.config.ts.
const E2E_AUTH_SECRET = 'e2e-local-only-auth-secret';

function seedEmailConfirmation(email: string, newEmail: string, code: string): void {
  // El correo capturado vive en el proceso Next. Sembrar un codigo sintetico
  // evita exponer un endpoint de pruebas o enviar correo real desde E2E.
  const db = new Database(path.resolve('data/my-closet-e2e.db'), { fileMustExist: true });
  try {
    const user = db.prepare<[string], { id: string }>('SELECT id FROM users WHERE email = ?').get(email);
    expect(user).toBeTruthy();
    const tokenHash = createHmac('sha256', E2E_AUTH_SECRET)
      .update(JSON.stringify(['email-change', user?.id, code])).digest('hex');
    const changed = db.prepare(`UPDATE email_change_tokens SET token_hash = ?, attempts = 0
      WHERE user_id = ? AND new_email = ?`).run(tokenHash, user?.id, newEmail);
    expect(changed.changes).toBe(1);
  } finally { db.close(); }
}

function seedPasswordReset(email: string): string {
  const token = randomBytes(32).toString('base64url');
  const db = new Database(path.resolve('data/my-closet-e2e.db'), { fileMustExist: true });
  try {
    const changed = db.prepare(`UPDATE password_reset_tokens SET token_hash = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)`)
      .run(createHash('sha256').update(token).digest('hex'), email);
    expect(changed.changes).toBe(1);
  } finally { db.close(); }
  return token;
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
    await expect(passwordForm.getByRole('button', { name: 'Solicitar cambio por correo' })).toBeDisabled();
    await passwordForm.getByLabel('Contraseña actual').fill('contrasena-segura');
    await passwordForm.getByRole('button', { name: 'Solicitar cambio por correo' }).click();
    await expect(page.getByText(/recibirás un enlace para cambiar tu contraseña/)).toBeVisible();
    const resetToken = seedPasswordReset(originalEmail);
    await page.goto(`/reset-password#token=${resetToken}`);
    await page.getByLabel(/^Nueva contraseña/).fill('contrasena-nueva');
    await page.getByLabel('Repite la contraseña').fill('contrasena-nueva');
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(page.getByText('Tu contraseña se actualizó correctamente.')).toBeVisible();
    await page.getByRole('link', { name: 'Iniciar sesión' }).click();
    await page.getByLabel('Correo electrónico').fill(originalEmail);
    await page.getByLabel('Contraseña', { exact: true }).fill('contrasena-nueva');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, Perfil');
    await page.goto('/profile');
    await waitForHydration(page);

    const email = `perfil.nuevo.${Date.now()}@test.local`;
    const emailForm = page.locator('form').filter({ hasText: 'Cambiar correo' });
    await emailForm.getByLabel('Correo nuevo').fill(email);
    await emailForm.getByLabel('Contraseña actual').fill('contrasena-nueva');
    await emailForm.getByRole('button', { name: 'Enviar código de verificación' }).click();
    await expect(page.getByText(`Código enviado a ${email}. Tu correo actual no ha cambiado.`)).toBeVisible();
    seedEmailConfirmation(originalEmail, email, '482913');
    const codeInput = page.getByRole('textbox', { name: 'Dígito 1 de 6', exact: true });
    const confirm = page.getByRole('button', { name: 'Confirmar nuevo correo' });
    const digits = page.getByRole('group', { name: 'Código de verificación', exact: true }).getByRole('textbox');
    await expect(digits).toHaveCount(6);
    await codeInput.pressSequentially('012345');
    for (const [index, digit] of [...'012345'].entries()) await expect(digits.nth(index)).toHaveValue(digit);
    await expect(confirm).toBeEnabled();
    await digits.nth(3).press('Backspace');
    await expect(digits.nth(3)).toBeEmpty();
    await expect(digits.nth(4)).toHaveValue('4');
    await expect(confirm).toBeDisabled();
    await digits.nth(3).fill('3');
    await expect(confirm).toBeEnabled();
    // Sustituye el código completo antes de probar la normalización parcial.
    await codeInput.fill('');
    for (let index = 1; index < 6; index++) await digits.nth(index).fill('');
    await codeInput.fill('12a3');
    await expect(digits.nth(0)).toHaveValue('1');
    await expect(digits.nth(2)).toHaveValue('3');
    await expect(digits.nth(3)).toBeFocused();
    await expect(confirm).toBeDisabled();
    await digits.nth(3).press('Backspace');
    await expect(digits.nth(2)).toBeEmpty();
    await expect(digits.nth(2)).toBeFocused();
    await digits.nth(2).press('ArrowLeft');
    await expect(digits.nth(1)).toBeFocused();
    await codeInput.fill('000000');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText('El código no es válido, venció o superó los intentos. Solicita uno nuevo.')).toBeVisible();
    // Pegar el código completo desde una casilla intermedia también reemplaza las seis.
    await digits.nth(4).evaluate(element => {
      const data = new DataTransfer();
      data.setData('text', '482-913');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    for (const [index, digit] of [...'482913'].entries()) await expect(digits.nth(index)).toHaveValue(digit);
    await confirm.click();
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
