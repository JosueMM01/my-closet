import { expect, test, type Page } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test.beforeEach(async ({ page }) => {
  // Test only our UI, never the OS installer or browser heuristics.
  await page.addInitScript(() => {
    window.addEventListener('beforeinstallprompt', event => {
      if (event.isTrusted) event.stopImmediatePropagation();
    });
  });
});

async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed', fail = false) {
  await page.evaluate(({ outcome, fail }) => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        const root = document.documentElement;
        root.dataset.installPromptCalls = String(Number(root.dataset.installPromptCalls ?? '0') + 1);
        if (fail) throw new Error('Synthetic installer failure');
      },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
  }, { outcome, fail });
}

async function openProfile(page: Page) {
  await page.getByTestId('nav-profile').click();
  await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();
}

test('conserva la oferta al navegar y no confunde aceptar con instalación completada', async ({ page }) => {
  await registerAndLogin(page, 'Instalación');
  await offerInstall(page, 'accepted'); // Offer arrives before Profile is mounted.
  await openProfile(page);
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completa la instalación' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '1');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('heading', { name: 'My Closet en tu dispositivo' })).toHaveCount(0);
});

test('al cancelar no reutiliza el evento y permite una oferta nueva', async ({ page }) => {
  await registerAndLogin(page);
  await openProfile(page);
  await offerInstall(page, 'dismissed');
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No se instaló la app' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toHaveCount(0);
  await offerInstall(page, 'accepted');
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt-calls', '2');
});

test('muestra instrucciones si el instalador falla', async ({ page }) => {
  await registerAndLogin(page);
  await openProfile(page);
  await offerInstall(page, 'accepted', true);
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No se pudo abrir el instalador' })).toBeVisible();
  await page.getByText('Cómo instalar la app', { exact: true }).click();
  await expect(page.getByText(/ese navegador puede no ofrecer instalación/)).toBeVisible();
});

test('sin aviso nativo ofrece una guía sin botón de instalación inoperante', async ({ page }) => {
  await registerAndLogin(page);
  await openProfile(page);
  await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toHaveCount(0);
  await page.getByText('Cómo instalar la app', { exact: true }).click();
  await expect(page.getByText(/inicia sesión con el mismo correo/)).toBeVisible();
});

test('en iPhone explica el flujo de Safari', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  });
  await registerAndLogin(page);
  await openProfile(page);
  await page.getByText('Instalar en iPhone o iPad', { exact: true }).click();
  await expect(page.getByText('Abre My Closet en Safari.')).toBeVisible();
  await expect(page.getByText(/Añadir a pantalla de inicio/)).toBeVisible();
});

test('no ofrece instalar cuando ya se ejecuta en modo app', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const media = original(query);
      if (query === '(display-mode: standalone)') Object.defineProperty(media, 'matches', { value: true });
      return media;
    };
  });
  await registerAndLogin(page);
  await openProfile(page);
  await expect(page.getByRole('heading', { name: 'My Closet en tu dispositivo' })).toHaveCount(0);
});

test('reconoce el modo app de Safari sin depender de matchMedia', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await registerAndLogin(page);
  await openProfile(page);
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'My Closet en tu dispositivo' })).toHaveCount(0);
});
