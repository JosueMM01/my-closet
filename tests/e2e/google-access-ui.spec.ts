import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

for (const linked of [false, true]) {
  test(`Google se presenta sin opción de desvincular: ${linked ? 'asociado' : 'sin asociar'}`, async ({ page }) => {
    const email = await registerAndLogin(page, 'Acceso Google');
    await page.route('**/api/auth/providers', (route) => route.fulfill({ json: {
      credentials: true, google: true, publicRegistration: true, invitationRegistration: true,
    } }));
    await page.route('**/api/profile/google', (route) => route.fulfill({ json: {
      linked, providerEmail: linked ? email : null,
    } }));
    await page.route('**/api/profile/google/picture?mode=availability', (route) => route.fulfill({ json: { available: false } }));
    await page.goto('/profile');
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Acceso con Google', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Desvincular Google' })).toHaveCount(0);
    if (linked) {
      await expect(page.getByText(`Puedes iniciar sesión con ${email}.`, { exact: false })).toBeVisible();
    } else {
      await expect(page.getByRole('link', { name: 'Continuar con Google', exact: true })).toHaveAttribute('href', '/api/auth/google/start?intent=link');
    }
    const response = await page.request.delete('/api/profile/google');
    expect(response.status()).toBe(405);
  });
}
