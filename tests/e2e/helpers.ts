import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

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
  await page.getByLabel('Contraseña', { exact: true }).fill('contrasena-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByTestId('home-greeting')).toContainText(
    `Hola, ${displayName.trim().split(/\s+/)[0] ?? displayName}`,
  );
  return email;
}

/** Fixture local: deja a esta cuenta como único admin para probar la UI real. */
export function grantAdminAccess(email: string): void {
  const database = new Database(path.resolve('data/my-closet-e2e.db'));
  try {
    database.transaction(() => {
      const current = database
        .prepare<[string], { id: string; role: string; status: string; admin_slot: number | null }>(
          'SELECT id, role, status, admin_slot FROM users WHERE email = ?',
        )
        .get(email);
      if (!current) throw new Error(`Cuenta E2E no encontrada: ${email}`);
      if (current.role === 'ADMIN' && current.status === 'ACTIVE') {
        database
          .prepare("UPDATE users SET role = 'USER', admin_slot = NULL WHERE id <> ? AND role = 'ADMIN'")
          .run(current.id);
        return;
      }

      const admins = database
        .prepare<[], { id: string; admin_slot: number }>(
          "SELECT id, admin_slot FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY admin_slot",
        )
        .all();
      if (admins.length >= 2) {
        database.prepare("UPDATE users SET role = 'USER', admin_slot = NULL WHERE id = ?").run(admins[1]?.id);
        admins.pop();
      }
      const used = new Set(admins.map((admin) => admin.admin_slot));
      const slot = used.has(1) ? 2 : 1;
      database
        .prepare("UPDATE users SET role = 'ADMIN', status = 'ACTIVE', admin_slot = ? WHERE id = ?")
        .run(slot, current.id);
      database
        .prepare("UPDATE users SET role = 'USER', admin_slot = NULL WHERE id <> ? AND role = 'ADMIN'")
        .run(current.id);
    })();
  } finally {
    database.close();
  }
}

export function createUserFixture(email: string, displayName: string): void {
  const database = new Database(path.resolve('data/my-closet-e2e.db'));
  try {
    database.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, role, status, admin_slot,
        profile_image_id, created_at
      ) VALUES (?, ?, ?, ?, 'USER', 'ACTIVE', NULL, NULL, ?)
    `).run(
      randomUUID(),
      email,
      displayName,
      'e2e-fixture-not-for-login',
      new Date().toISOString(),
    );
  } finally {
    database.close();
  }
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
