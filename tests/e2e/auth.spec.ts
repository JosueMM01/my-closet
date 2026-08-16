import { expect, test } from '@playwright/test';
import { registerAndLogin, uniqueEmail, waitForHydration } from './helpers';

test.describe('Autenticación', () => {
  test('registro crea sesión y muestra el home', async ({ page }) => {
    await registerAndLogin(page, 'María');
    await expect(page.getByTestId('home-greeting')).toBeVisible();
  });

  test('logout y login posterior', async ({ page }) => {
    const email = await registerAndLogin(page, 'Ana');
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: false }).fill('contrasena-segura');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, Ana');
  });

  test('credenciales incorrectas muestran error', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('nadie'));
    await page.getByLabel('Contraseña', { exact: false }).fill('incorrecta-total');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('p[role=alert]')).toContainText('incorrectos');
  });

  test('sin sesión, rutas privadas redirigen a login', async ({ page }) => {
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
