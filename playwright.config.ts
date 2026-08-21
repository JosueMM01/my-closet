import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // flujos con estado compartido (IndexedDB/SQLite)
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  expect: {
    timeout: 10_000,
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npx -y pnpm@11.22.0 exec next start -p ' + PORT,
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'production',
      // Secreto de prueba exclusivo del servidor E2E local.
      AUTH_SECRET: 'e2e-local-only-auth-secret',
      PUBLIC_REGISTRATION_ENABLED: 'true',
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'file:./data/my-closet-e2e.db',
      IMAGE_PROVIDER: 'local',
      GOOGLE_AUTH_ENABLED: 'false',
      EMAIL_PROVIDER: 'capture',
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      // La suite registra muchos usuarios desde 127.0.0.1: límite elevado.
      AUTH_RATE_LIMIT_REGISTER: '500',
    },
  },
  projects: [
    { name: 'chromium-mobile-small', use: { ...devices['Pixel 5'] , viewport: { width: 360, height: 800 } } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
