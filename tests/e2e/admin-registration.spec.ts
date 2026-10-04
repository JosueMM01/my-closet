import { expect, test } from '@playwright/test';
import {
  createUserFixture,
  grantAdminAccess,
  registerAndLogin,
  uniqueEmail,
  waitForHydration,
} from './helpers';

test.describe('Registro por invitación', () => {
  test('sin invitación explica que el registro público está cerrado', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: false,
        invitationRegistration: true,
      },
    }));
    await page.goto('/register');
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Necesitas una invitación' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta' })).toHaveCount(0);
  });

  test('login nunca muestra Crear cuenta aunque el registro público esté habilitado', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: true,
        invitationRegistration: true,
      },
    }));
    await page.goto('/login');
    await waitForHydration(page);
    await expect(page.getByText('Crear cuenta', { exact: true })).toHaveCount(0);
  });
});

test.describe('Administración', () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'La fixture admin usa SQLite E2E local.');

  test('solo ADMIN ve el panel; crea, copia y usa una invitación', async ({ page, browser, context }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Invitaciones');
    await page.goto('/profile');
    await waitForHydration(page);
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);

    grantAdminAccess(adminEmail);
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText('Sin conexión: puedes consultar la caché')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Crear invitación de 7 días' })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();

    const invitedEmail = uniqueEmail('invitada');
    await page.getByLabel('Correo de la persona invitada').fill(invitedEmail);
    await page.getByRole('button', { name: 'Crear invitación de 7 días' }).click();
    await expect(page.getByText('Invitación capturada para pruebas. Caduca en 7 días.')).toBeVisible();
    const inviteUrl = await page.getByLabel('Enlace listo para compartir').inputValue();
    expect(inviteUrl).toContain('/register#invite=');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copiar enlace' }).click();
    await expect(page.getByText('Enlace de invitación copiado.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);

    const invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await invitedPage.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: false,
        invitationRegistration: true,
      },
    }));
    await invitedPage.goto(inviteUrl);
    await waitForHydration(invitedPage);
    await expect(invitedPage).toHaveURL(/\/register$/);
    await expect(invitedPage.getByText(invitedEmail, { exact: true })).toBeVisible();
    await invitedPage.getByLabel('Nombre').fill('Persona Invitada');
    await expect(invitedPage.getByLabel('Correo electrónico')).toHaveCount(0);
    await invitedPage.getByLabel('Contraseña', { exact: true }).fill('contrasena-invitada');
    await invitedPage.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(invitedPage.getByTestId('home-greeting')).toContainText('Hola, Persona');
    await invitedContext.close();
  });

  test('el servidor impide un tercer administrador activo', async ({ page }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Límite');
    grantAdminAccess(adminEmail);
    await page.goto('/profile');
    await waitForHydration(page);
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    const secondEmail = uniqueEmail('admin-dos');
    const thirdEmail = uniqueEmail('admin-tres');
    createUserFixture(secondEmail, 'Admin Dos');
    createUserFixture(thirdEmail, 'Admin Tres');

    await page.getByRole('button', { name: 'Actualizar datos' }).click();
    await expect(page.getByText('Datos de administración actualizados.')).toBeVisible();
    const second = page.locator('li').filter({ hasText: secondEmail });
    await second.getByRole('button', { name: 'Hacer admin' }).click();
    await expect(page.getByText('2/2 admins activos')).toBeVisible();
    // Native options have their own disabled state; checking the owning select
    // would incorrectly require USER invitations to be disabled as well.
    await expect(page.getByRole('option', { name: 'Administrador (cupo completo)' })).toHaveJSProperty('disabled', true);
    await expect(page.getByText('Cupo completo: ya hay dos administradores activos. Solo puedes invitar como Usuario.')).toBeVisible();

    // UI caching does not grant permission: a forged request is rejected by the server.
    const before = await page.request.get('/api/admin/invitations');
    const rejected = await page.request.post('/api/admin/invitations', {
      headers: { origin: new URL(page.url()).origin },
      data: { email: uniqueEmail('admin-bloqueado'), role: 'ADMIN', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error).toContain('Ya existen dos administradores activos');
    const after = await page.request.get('/api/admin/invitations');
    expect((await after.json()).invitations.length).toBe((await before.json()).invitations.length);

    const third = page.locator('li').filter({ hasText: thirdEmail });
    await third.getByRole('button', { name: 'Hacer admin' }).click();
    await expect(page.getByTestId('admin-panel').getByRole('alert')).toContainText(
      'Ya existen dos administradores activos',
    );
  });
});
