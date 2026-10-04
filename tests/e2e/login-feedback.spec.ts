import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/providers', (route) => route.fulfill({ json: {
    credentials: true, google: true, publicRegistration: false, invitationRegistration: true,
  } }));
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { authenticated: false } }));
});

test('login muestra nombre de Google y candado sin tapar contraseña', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Iniciar sesión con Google', exact: true })).toBeVisible();
  const password = page.getByLabel('Contraseña', { exact: true });
  const lock = page.getByTestId('login-password-lock');
  await expect(lock).toBeVisible();
  await expect(password).toHaveCSS('padding-left', '40px');
  await expect.poll(() => lock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('[data-testid="login-password-lock"]') === element;
  })).toBe(false); // pointer-events:none leaves the input usable, not an overlay.
  await password.fill('contraseña-de-prueba');
  await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ocultar contraseña' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

for (const [reason, message] of [
  ['account-unavailable', 'No se encontró una cuenta activa vinculada'],
  ['cancelled', 'Cancelaste o no autorizaste'],
  ['session-invalid', 'La solicitud de acceso con Google ya no es válida'],
] as const) {
  test(`login explica ${reason} y retira el resultado de la URL`, async ({ page }) => {
    await page.goto(`/login?google=${reason}`);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(message);
    await expect(page).toHaveURL(/\/login$/);
  });
}

test('un perfil local no oculta un error nuevo de Google con una redirección', async ({ page }) => {
  // Synthetic read-model: no real OAuth, cookie issuance or staging account writes.
  await page.route('**/api/sync/**', (route) => route.fulfill({ status: 401, json: { error: 'Sin sesión de prueba' } }));
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
    authenticated: true,
    profile: {
      userId: '22222222-2222-4222-8222-222222222222', email: 'fixture@example.test',
      displayName: 'Perfil de prueba', role: 'USER', profileImageId: null,
      createdAt: '2026-10-04T00:00:00.000Z',
    },
  } }));
  await page.goto('/login?google=account-unavailable');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('No se encontró una cuenta activa vinculada');
  await expect(page.getByRole('link', { name: 'Iniciar sesión con Google', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
