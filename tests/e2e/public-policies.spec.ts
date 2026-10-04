import { expect, test } from '@playwright/test';

const documents = [
  ['/about', 'Menos buscar.Más combinar.'],
  ['/privacy', 'Política de privacidad'],
  ['/terms', 'Términos de uso'],
] as const;

test.describe('Información pública @public-policies', () => {
  for (const [route, title] of documents) {
    test(`${route} sin sesión y sin activar recursos privados`, async ({ page }) => {
      const privateRequests: string[] = [];
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.startsWith('/api/') || pathname === '/sw.js' || pathname.startsWith('/models/')
          || pathname.includes('background-removal')) privateRequests.push(pathname);
      });
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await page.waitForLoadState('load');
      await expect(page.getByRole('heading', { name: 'Responsable y contacto' })).toBeVisible();
      expect(privateRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((entries) => entries.length))).toBe(0);
    });
  }

  test('documentos legibles y enlaces funcionales sin JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto('/about');
      await page.getByRole('link', { name: 'Privacidad', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Política de privacidad');
      await expect(page.getByRole('heading', { name: 'Retención, eliminación y respaldos' })).toBeVisible();
      await page.getByRole('link', { name: 'Términos', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Términos de uso');
    } finally { await context.close(); }
  });

  test('login y registro enlazan los documentos públicos', async ({ page }) => {
    for (const route of ['/login', '/register']) {
      await page.goto(route);
      const navigation = page.getByRole('navigation', { name: 'Información pública' });
      await expect(navigation.getByRole('link', { name: 'Privacidad' })).toHaveAttribute('href', '/privacy');
      await expect(navigation.getByRole('link', { name: 'Términos' })).toHaveAttribute('href', '/terms');
    }
  });
});
