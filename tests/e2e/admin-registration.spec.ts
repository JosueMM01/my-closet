import { expect, test } from '@playwright/test';
import {
  createUserFixture,
  grantAdminAccess,
  registerAndLogin,
  uniqueEmail,
  waitForHydration,
} from './helpers';

test.describe('Registro por invitación', () => {
  test('sin invitación explica que el registro público está cerrado', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: false,
        invitationRegistration: true,
      },
    }));
    await page.goto('/register');
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Necesitas una invitación' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta' })).toHaveCount(0);
  });

  test('login nunca muestra Crear cuenta aunque el registro público esté habilitado', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: true,
        invitationRegistration: true,
      },
    }));
    await page.goto('/login');
    await waitForHydration(page);
    await expect(page.getByText('Crear cuenta', { exact: true })).toHaveCount(0);
  });
});

test.describe('Administración', () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'La fixture admin usa SQLite E2E local.');

  test('elimina una cuenta solo tras desactivarla y confirmar con contraseña ADMIN', async ({ page, context }) => {
    test.skip(process.env.ADMIN_ACCOUNT_DELETION_ENABLED !== 'true' || process.env.ACCOUNT_DELETION_ENABLED !== 'true', 'Requiere banderas exclusivas de la prueba local');
    const adminEmail = await registerAndLogin(page, 'Admin Baja');
    grantAdminAccess(adminEmail);
    const targetEmail = uniqueEmail('baja-administrativa');
    createUserFixture(targetEmail, 'Cuenta desechable');
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    await page.getByLabel('Buscar cuenta').fill(targetEmail);
    const row = page.getByTestId('admin-panel').getByRole('listitem').filter({ hasText: targetEmail });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button', { name: 'Eliminar cuenta', exact: true })).toHaveCount(0);
    await row.getByRole('button', { name: 'Desactivar', exact: true }).click();
    const remove = row.getByRole('button', { name: 'Eliminar cuenta', exact: true });
    await remove.click();
    const modal = page.getByRole('dialog', { name: 'Eliminar cuenta desactivada' });
    await expect(modal.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(remove).toBeFocused();
    await remove.click();
    const confirm = modal.getByRole('button', { name: 'Confirmar eliminación' });
    await expect(confirm).toBeDisabled();
    await modal.getByLabel('Tu contraseña de administrador').fill('incorrecta');
    await modal.getByRole('checkbox').check();
    await context.setOffline(true);
    await expect(confirm).toBeDisabled();
    await context.setOffline(false);
    await confirm.click();
    await expect(modal.getByRole('alert')).toHaveText('Tu contraseña de administrador es incorrecta');
    await modal.getByLabel('Tu contraseña de administrador').fill('contrasena-segura');
    await page.route('**/api/admin/users', route => route.fulfill({ status: 503, json: { error: 'Fallo de refresco sintético' } }));
    await confirm.click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByText('Cuenta eliminada de los datos activos. Las copias de respaldo siguen su retención.')).toBeVisible();
    await expect(page.getByText('La baja fue confirmada, pero falta actualizar la lista. Pulsa Actualizar datos; no repitas la eliminación.')).toBeVisible();
    await page.unroute('**/api/admin/users');
    await page.getByRole('button', { name: 'Actualizar datos' }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();
  });

  test('permite buscar cuentas y cambiar la paginación', async ({ page }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Páginas');
    grantAdminAccess(adminEmail);
    const prefix = `pagina${Date.now()}`;
    for (let index = 0; index < 12; index++) createUserFixture(`${prefix}.${index}@test.local`, `Prueba ${index}`);
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    await page.getByLabel('Buscar cuenta').fill(prefix);
    await expect(page.getByText('12 cuentas · Página 1 de 2')).toBeVisible();
    await expect(page.getByTestId('admin-panel').getByRole('listitem')).toHaveCount(10);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText('12 cuentas · Página 2 de 2')).toBeVisible();
    await expect(page.getByTestId('admin-panel').getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('Por página').selectOption('20');
    await expect(page.getByText('12 cuentas · Página 1 de 1')).toBeVisible();
    await page.getByLabel('Buscar cuenta').fill(`${prefix}.11@test.local`);
    await expect(page.getByText('1 cuenta · Página 1 de 1')).toBeVisible();
  });

  test('solo ADMIN ve el panel; crea, copia y usa una invitación', async ({ page, browser, context }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Invitaciones');
    await page.goto('/profile');
    await waitForHydration(page);
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);

    grantAdminAccess(adminEmail);
    await page.reload();
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    if (process.env.PROFILE_CAPTURE === '1') {
      await page.getByTestId('admin-panel').scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath('panel-administrador.png') });
      await page.getByRole('tab', { name: 'Seguridad', exact: true }).click();
      await page.getByRole('button', { name: /Cambiar contraseña/ }).click();
      await page.screenshot({ path: test.info().outputPath('perfil-modal.png') });
      await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
      await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    }

    await context.setOffline(true);
    await expect(page.getByText('Sin conexión: puedes consultar la caché')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Crear invitación', exact: true })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();

    const invitedEmail = uniqueEmail('invitada');
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    await page.getByLabel('Correo de la persona invitada').fill(invitedEmail);
    await page.getByRole('button', { name: 'Crear invitación de 7 días' }).click();
    await expect(page.getByText('Invitación capturada para pruebas. Caduca en 7 días.')).toBeVisible();
    const inviteUrl = await page.getByLabel('Enlace listo para compartir').inputValue();
    expect(inviteUrl).toContain('/register#invite=');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copiar enlace' }).click();
    await expect(page.getByText('Enlace de invitación copiado.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);

    const invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await invitedPage.route('**/api/auth/providers', (route) => route.fulfill({
      json: {
        credentials: true,
        google: false,
        publicRegistration: false,
        invitationRegistration: true,
      },
    }));
    await invitedPage.goto(inviteUrl);
    await waitForHydration(invitedPage);
    await expect(invitedPage).toHaveURL(/\/register$/);
    await expect(invitedPage.getByText(invitedEmail, { exact: true })).toBeVisible();
    await invitedPage.getByLabel('Nombre').fill('Persona Invitada');
    await expect(invitedPage.getByLabel('Correo electrónico')).toHaveCount(0);
    await invitedPage.getByLabel('Contraseña', { exact: true }).fill('contrasena-invitada');
    await invitedPage.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(invitedPage.locator('form').getByRole('alert')).toHaveText('Las contraseñas no coinciden');
    await invitedPage.getByLabel('Confirmar contraseña', { exact: true }).fill('contrasena-invitada');
    await invitedPage.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(invitedPage.getByTestId('home-greeting')).toContainText('Hola, Persona');
    await invitedContext.close();
  });

  test('el servidor impide un tercer administrador activo', async ({ page }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Límite');
    grantAdminAccess(adminEmail);
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    const secondEmail = uniqueEmail('admin-dos');
    const thirdEmail = uniqueEmail('admin-tres');
    createUserFixture(secondEmail, 'Admin Dos');
    createUserFixture(thirdEmail, 'Admin Tres');

    await page.getByRole('button', { name: 'Actualizar datos' }).click();
    await expect(page.getByText('Datos de administración actualizados.')).toBeVisible();
    await page.getByLabel('Buscar cuenta').fill(secondEmail);
    const second = page.locator('li').filter({ hasText: secondEmail });
    await second.getByRole('button', { name: 'Hacer admin' }).click();
    await expect(page.getByText('2/2 admins activos')).toBeVisible();
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    // Native options have their own disabled state; checking the owning select
    // would incorrectly require USER invitations to be disabled as well.
    await expect(page.getByRole('option', { name: 'Administrador (cupo completo)' })).toHaveJSProperty('disabled', true);
    await expect(page.getByText('Cupo completo: ya hay dos administradores activos. Solo puedes invitar como Usuario.')).toBeVisible();
    await page.getByRole('dialog', { name: 'Crear invitación' }).getByRole('button', { name: 'Cerrar' }).click();

    // UI caching does not grant permission: a forged request is rejected by the server.
    const before = await page.request.get('/api/admin/invitations');
    const rejected = await page.request.post('/api/admin/invitations', {
      headers: { origin: new URL(page.url()).origin },
      data: { email: uniqueEmail('admin-bloqueado'), role: 'ADMIN', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error).toContain('Ya existen dos administradores activos');
    const after = await page.request.get('/api/admin/invitations');
    expect((await after.json()).invitations.length).toBe((await before.json()).invitations.length);

    await page.getByLabel('Buscar cuenta').fill(thirdEmail);
    const third = page.locator('li').filter({ hasText: thirdEmail });
    await expect(third.getByRole('button', { name: 'Hacer admin' })).toBeDisabled();
  });

  test('una invitación ADMIN reserva cupo, bloquea otra y revocarla libera la plaza', async ({ page }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Reservas');
    grantAdminAccess(adminEmail);
    const userEmail = uniqueEmail('reservas-user');
    createUserFixture(userEmail, 'Usuario Reservas');
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    const panel = page.getByTestId('admin-panel');
    const invitedEmail = uniqueEmail('admin-reservado');
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    await page.getByLabel('Correo de la persona invitada').fill(invitedEmail);
    await page.getByLabel('Rol inicial').selectOption('ADMIN');
    await page.getByRole('button', { name: 'Crear invitación de 7 días' }).click();
    await expect(page.getByText('Invitación capturada para pruebas. Caduca en 7 días.')).toBeVisible();
    await expect(panel.getByText('1/2 admins activos · 1 plaza reservada')).toBeVisible();
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Administrador (plaza reservada)' })).toHaveJSProperty('disabled', true);
    await expect(panel.getByRole('status')).toContainText('Revoca una invitación ADMIN');
    await page.getByRole('dialog', { name: 'Crear invitación' }).getByRole('button', { name: 'Cerrar' }).click();
    await page.getByLabel('Buscar cuenta').fill(userEmail);
    const user = panel.getByRole('listitem').filter({ hasText: userEmail });
    await expect(user.getByRole('button', { name: 'Hacer admin' })).toBeDisabled();
    const rejected = await page.request.post('/api/admin/invitations', {
      headers: { origin: new URL(page.url()).origin },
      data: { email: uniqueEmail('admin-sin-cupo'), role: 'ADMIN', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error).toContain('Revoca una invitación ADMIN');
    await panel.getByText(/Invitaciones pendientes \(/).click();
    await panel.getByRole('listitem').filter({ hasText: invitedEmail }).getByRole('button', { name: 'Revocar invitación' }).click();
    await expect(panel.getByText('1/2 admins activos · 0 plazas reservadas')).toBeVisible();
    await expect(user.getByRole('button', { name: 'Hacer admin' })).toBeEnabled();
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Administrador', exact: true })).toHaveJSProperty('disabled', false);
  });

  test('la reserva desaparece al caducar sin recargar el panel', async ({ page }) => {
    const adminEmail = await registerAndLogin(page, 'Admin Caducidad');
    grantAdminAccess(adminEmail);
    await page.goto('/profile');
    await waitForHydration(page);
    await page.getByRole('tab', { name: 'Administración', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();
    await page.clock.install();
    const beforeCreate = Date.now();
    const created = await page.request.post('/api/admin/invitations', {
      headers: { origin: new URL(page.url()).origin },
      data: { email: uniqueEmail('admin-caduca'), role: 'ADMIN', expiresAt: new Date(Date.now() + 5_000).toISOString() },
    });
    expect(created.status()).toBe(201);
    const { invitation } = await created.json();
    const expiresAt = Date.parse(invitation.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(beforeCreate + 7 * 24 * 60 * 60 * 1_000);
    expect(expiresAt).toBeLessThan(Date.now() + 7 * 24 * 60 * 60 * 1_000 + 5_000);
    await page.getByRole('button', { name: 'Actualizar datos' }).click();
    await expect(page.getByText('1/2 admins activos · 1 plaza reservada')).toBeVisible();
    await page.clock.fastForward(7 * 24 * 60 * 60 * 1_000 + 10_000);
    await expect(page.getByText('1/2 admins activos · 0 plazas reservadas')).toBeVisible();
    await page.getByRole('button', { name: 'Crear invitación', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Administrador', exact: true })).toHaveJSProperty('disabled', false);
  });
});
