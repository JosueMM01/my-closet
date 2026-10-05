import { expect, test } from '@playwright/test';
import { registerAndLogin, uniqueEmail, waitForHydration } from './helpers';

test.describe('Autenticación', () => {
  test('Google permanece oculto cuando el proveedor está deshabilitado', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);
    await expect(page.getByRole('link', { name: 'Iniciar sesión con Google', exact: true })).toHaveCount(0);
  });

  test('Google usa el inicio OAuth con intención login cuando está habilitado', async ({ page }) => {
    await page.route('**/api/auth/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          credentials: true,
          google: true,
          publicRegistration: true,
          invitationRegistration: true,
        }),
      });
    });
    await page.goto('/login');
    await waitForHydration(page);
    await expect(page.getByRole('link', { name: 'Iniciar sesión con Google', exact: true })).toHaveAttribute(
      'href',
      '/api/auth/google/start?intent=login',
    );
  });

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
    await page.getByLabel('Contraseña', { exact: true }).fill('contrasena-segura');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, Ana');
  });

  test('restaura IndexedDB desde una sesión remota activa', async ({ page }) => {
    await registerAndLogin(page, 'OAuth Local');
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('my-closet');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('kv', 'readwrite');
          transaction.objectStore('kv').delete('local-profile');
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });

    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-greeting')).toContainText('Hola, OAuth');
  });

  test('credenciales incorrectas muestran error', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('nadie'));
    await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta-total');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('p[role=alert]')).toContainText('incorrectos');
  });

  test('permite mostrar y ocultar la contraseña sin enviar el formulario', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);
    const password = page.getByLabel('Contraseña', { exact: true });
    await password.fill('texto-visible');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: 'Ocultar contraseña' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('recuperación muestra el mismo éxito genérico para un correo desconocido', async ({ page }) => {
    await page.goto('/forgot-password');
    await waitForHydration(page);
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('desconocido'));
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Si existe una cuenta activa con ese correo, recibirás un enlace',
    );
  });

  test('sin sesión, rutas privadas redirigen a login', async ({ page }) => {
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
