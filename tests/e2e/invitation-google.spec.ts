import { expect, test, type Page } from '@playwright/test';
import { registerAndLogin } from './helpers';

const token = 't'.repeat(43);
async function invitation(page: Page, email = 'invite@example.test') {
  await page.route('**/api/auth/providers', route => route.fulfill({ json: {
    credentials: true, google: true, publicRegistration: false, invitationRegistration: true,
  } }));
  await page.route('**/api/auth/invitation', route => route.fulfill({ json: {
    email, role: 'USER', expiresAt: new Date(Date.now() + 60_000).toISOString(), googleAvailable: true,
  } }));
}

test('invitación Google navega sin formulario externo bajo CSP self', async ({ page }) => {
  await invitation(page);
  const violations: string[] = [];
  await page.exposeFunction('recordCspViolation', (directive: string) => violations.push(directive));
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', event => {
      const record = (window as unknown as { recordCspViolation: (directive: string) => void }).recordCspViolation;
      record(event.violatedDirective);
    });
  });
  await page.route('**/api/auth/google/start', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-requested-with']).toBe('my-closet');
    expect(route.request().postDataJSON()).toEqual({ invitationToken: token });
    return route.fulfill({ json: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-only' } });
  });
  await page.route('https://accounts.google.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Google simulado</h1>',
  }));
  const response = await page.goto(`/register#invite=${token}`);
  expect(response?.headers()['content-security-policy']).toContain("form-action 'self'");
  await page.getByRole('button', { name: 'Iniciar sesión con Google', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Google simulado' })).toBeVisible();
  expect(violations).not.toContain('form-action');
  expect(page.url()).not.toContain(token);
});

test('fallo de inicio Google muestra error local y permite reintentar', async ({ page }) => {
  await invitation(page);
  await page.route('**/api/auth/google/start', route => route.fulfill({ status: 410, json: { error: 'La invitación ya fue utilizada' } }));
  await page.goto(`/register#invite=${token}`);
  await page.getByRole('button', { name: 'Iniciar sesión con Google', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('La invitación ya fue utilizada');
  await expect(page.getByRole('button', { name: 'Iniciar sesión con Google', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/register$/);
});

test('invitación usada con sesión abierta no solicita cerrar sesión', async ({ page }) => {
  await registerAndLogin(page, 'Invitada');
  await invitation(page);
  await page.route('**/api/auth/invitation', route => route.fulfill({ status: 410, json: { error: 'La invitación no es válida o ya fue utilizada' } }));
  await page.goto(`/register#invite=${token}`);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('ya fue utilizada');
  await expect(page.getByRole('button', { name: 'Cerrar sesión para aceptar la invitación' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ir a mi armario' })).toBeVisible();
});

test('invitación vigente de otra cuenta sí ofrece cerrar sesión', async ({ page }) => {
  await registerAndLogin(page, 'Cuenta anterior');
  await invitation(page);
  await page.goto(`/register#invite=${token}`);
  await expect(page.getByRole('button', { name: 'Cerrar sesión para aceptar la invitación' })).toBeVisible();
});
