import { expect, test, type Page } from '@playwright/test';

const profile = {
  userId: '22222222-2222-4222-8222-222222222222', email: 'owner@example.test',
  displayName: 'Cuenta original', role: 'USER', status: 'ACTIVE', profileImageId: null,
  createdAt: '2026-10-04T00:00:00.000Z',
};

async function seedLocalOwner(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Fixture sin acceso externo' } }));
  await page.route('**/api/auth/providers', route => route.fulfill({ json: {
    credentials: true, google: true, publicRegistration: false, invitationRegistration: true,
  } }));
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, profile } }));
  await page.goto('/login?google=cancelled');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Cancelaste');
  // Esperar el write real de IndexedDB: la alerta de OAuth por sí sola no lo garantiza.
  await page.goto('/profile');
  await expect(page.getByRole('textbox', { name: 'Nombre' })).toHaveValue(profile.displayName);
}

test('recuperación no redirige por perfil local y contraseña vuelve a la misma cuenta', async ({ page }) => {
  await seedLocalOwner(page);
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: false } }));
  await page.reload();
  await page.route('**/api/auth/logout', route => route.fulfill({ json: { ok: true } }));
  await page.getByRole('button', { name: 'Iniciar sesión de nuevo', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reauth=1&next=\/profile$/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.route('**/api/auth/login', route => route.fulfill({ json: { profile } }));
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(profile.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
});

test('retorno OAuth de otra cuenta revoca sesión y no reemplaza IndexedDB', async ({ page }) => {
  await seedLocalOwner(page);
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, profile: { ...profile, userId: '33333333-3333-4333-8333-333333333333', displayName: 'Cuenta ajena', email: 'other@example.test' },
  } }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Iniciar sesión de nuevo', exact: true })).toBeVisible();
  let revoked = false;
  await page.route('**/api/auth/logout', route => {
    revoked = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/login?reauth=1&next=/profile');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('La sesión pertenece a otra cuenta');
  expect(revoked).toBe(true);
  await expect(page).toHaveURL(/\/login\?reauth=1/);
  await page.goto('/profile');
  await expect(page.getByRole('textbox', { name: 'Nombre' })).toHaveValue(profile.displayName);
});

test('retorno OAuth de la misma cuenta completa recuperación', async ({ page }) => {
  await seedLocalOwner(page);
  await page.goto('/login?reauth=1&next=/profile');
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('textbox', { name: 'Nombre' })).toHaveValue(profile.displayName);
});

test('invitación abierta en otra pestaña exige cambio explícito sin perder el token', async ({ page }) => {
  await seedLocalOwner(page);
  await page.route('**/api/auth/invitation', route => route.fulfill({ json: {
    email: 'invitee@example.test', role: 'USER', expiresAt: '2099-01-01T00:00:00.000Z', googleAvailable: true,
  } }));
  await page.goto('/register#invite=synthetic-invitation-token-only-for-test');
  await expect(page.getByRole('heading', { name: 'Hay una cuenta abierta en este dispositivo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toHaveCount(0);
  await page.route('**/api/auth/logout', async route => {
    await page.route('**/api/auth/session', r => r.fulfill({ json: { authenticated: false } }));
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole('button', { name: 'Cerrar sesión para aceptar la invitación' }).click();
  await expect(page.getByText('invitee@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeVisible();
  await expect(page.locator('input[name="invitationToken"]')).toHaveValue('synthetic-invitation-token-only-for-test');
  await expect(page).toHaveURL(/\/register$/);
});
