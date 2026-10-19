import { expect, test } from '@playwright/test';

test('login exige verificación, envía token en memoria y renueva tras credenciales incorrectas', async ({ page }) => {
  await page.route('**/api/auth/providers', route => route.fulfill({ json: {
    credentials: true, google: false, publicRegistration: false, invitationRegistration: true,
    turnstile: { enabled: true, siteKey: 'synthetic-site' },
  } }));
  // Sustituto local: ninguna llamada real a Cloudflare ni desafío resuelto por el agente.
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render(container, options) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = 'Verificar para prueba';
        button.onclick = () => options.callback('synthetic-token');
        container.append(button); return 'synthetic-widget';
      }, remove() {}
    };`,
  }));
  const tokens: string[] = [];
  await page.route('**/api/auth/login', route => {
    const payload = route.request().postDataJSON() as { turnstileToken: string };
    tokens.push(payload.turnstileToken);
    return route.fulfill({ status: 401, json: { error: 'Correo o contraseña incorrectos' } });
  });
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('synthetic@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  const submit = page.getByRole('button', { name: 'Entrar', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Verificar para prueba' }).click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: 'incorrectos' })).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(tokens).toEqual(['synthetic-token']);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('synthetic-token');
});

test('configuración incompleta no permite enviar login ni carga Cloudflare', async ({ page }) => {
  await page.route('**/api/auth/providers', route => route.fulfill({ json: {
    credentials: true, google: false, publicRegistration: false, invitationRegistration: true,
    turnstile: { enabled: true, siteKey: null },
  } }));
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('challenges.cloudflare.com')) requests.push(request.url()); });
  await page.goto('/login');
  await expect(page.getByRole('alert').filter({ hasText: 'no está configurada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeDisabled();
  expect(requests).toEqual([]);
});
