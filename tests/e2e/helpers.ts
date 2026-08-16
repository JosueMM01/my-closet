import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.local`;
}

/**
 * Espera a que React complete la hidratación antes de interactuar.
 * networkidle asegura que todos los chunks JS se descargaron y ejecutaron
 * (la hidratación ocurre en esa misma cadena de tareas).
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('load').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/** Registra una cuenta nueva y espera el home con saludo. */
export async function registerAndLogin(page: Page, displayName = 'María'): Promise<string> {
  const email = uniqueEmail();
  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Nombre').fill(displayName);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: false }).fill('contrasena-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByTestId('home-greeting')).toContainText(`Hola, ${displayName}`);
  return email;
}

/** Crea una prenda mínima desde la UI y vuelve al armario. */
export async function createGarment(
  page: Page,
  name: string,
  category = 'Partes de arriba',
): Promise<void> {
  await page.goto('/wardrobe/new');
  await waitForHydration(page);
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  // Categoría viene preseleccionada (tops); elegir la pedida si es distinta.
  const chip = page.getByRole('button', { name: category, exact: true });
  if (await chip.count()) {
    await chip.first().click();
  }
  await page.getByTestId('save-garment').click();
  await expect(page.getByTestId('garment-name')).toContainText(name);
}
