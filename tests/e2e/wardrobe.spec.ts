import { expect, test } from '@playwright/test';
import { createGarment, registerAndLogin, waitForHydration } from './helpers';

test.describe('Wardrobe', () => {
  test('crear prenda y verla en el armario', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Blusa de lino');
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await expect(page.getByTestId('wardrobe-count')).toContainText('1 prenda');
    await expect(page.getByTestId('garment-card').first()).toContainText('Blusa de lino');
  });

  test('editar prenda cambia el nombre', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Falda original');
    await page.getByTestId('edit-garment').click();
    await page.getByLabel('Nombre', { exact: true }).fill('Falda plisada');
    await page.getByTestId('save-garment').click();
    await expect(page.getByTestId('garment-name')).toContainText('Falda plisada');
  });

  test('archivar oculta la prenda del armario activo', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Abrigo viejo');
    await page.getByTestId('archive-garment').click();
    // Esperar a que la escritura local se confirme (el botón cambia de texto).
    await expect(page.getByTestId('archive-garment')).toContainText('Desarchivar');
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await expect(page.getByTestId('wardrobe-count')).toContainText('0 prendas');
    // Filtro de archivadas la muestra
    await page.getByTestId('wardrobe-filters-toggle').click();
    await page.getByRole('button', { name: 'Archivadas' }).click();
    await expect(page.getByTestId('wardrobe-count')).toContainText('1 prenda');
  });

  test('clonar crea una copia', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Vestido azul');
    await page.getByTestId('clone-garment').click();
    await expect(page.getByTestId('garment-name')).toContainText('(copia)');
  });

  test('eliminar prenda con confirmación', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Camiseta gris');
    await page.getByTestId('delete-garment').click();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page).toHaveURL(/\/wardrobe$/);
    await expect(page.getByTestId('wardrobe-count')).toContainText('0 prendas');
  });

  test('búsqueda filtra por nombre', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Pantalón negro');
    await createGarment(page, 'Bufanda roja');
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await page.getByTestId('wardrobe-search').fill('bufanda');
    await expect(page.getByTestId('wardrobe-count')).toContainText('1 prenda');
    await expect(page.getByTestId('garment-card').first()).toContainText('Bufanda');
  });

  test('filtros por categoría funcionan', async ({ page }) => {
    await registerAndLogin(page);
    await createGarment(page, 'Camisa blanca', 'Partes de arriba');
    await createGarment(page, 'Botines', 'Calzado');
    await page.goto('/wardrobe');
    await waitForHydration(page);
    await page.getByTestId('wardrobe-filters-toggle').click();
    await page.getByRole('button', { name: 'Calzado', exact: true }).click();
    await expect(page.getByTestId('wardrobe-count')).toContainText('1 prenda');
    await expect(page.getByTestId('garment-card').first()).toContainText('Botines');
  });
});
