import { expect, test } from '@playwright/test';
import { registerAndLogin, waitForHydration } from './helpers';

test.describe('Carrusel de inspiración', () => {
  test('navega con controles y mantiene las imágenes completas en móvil', async ({ page }) => {
    await registerAndLogin(page, 'Carrusel Móvil');
    await waitForHydration(page);

    const carousel = page.getByTestId('featured-carousel');
    await expect(carousel).toBeVisible();
    await expect(carousel.locator('[data-active="true"]')).toHaveAttribute(
      'aria-label',
      '1 de 4',
    );

    await page.getByRole('button', { name: 'Siguiente imagen' }).click();
    await expect(carousel.locator('[data-active="true"]')).toHaveAttribute(
      'aria-label',
      '2 de 4',
    );

    await page.getByRole('button', { name: 'Mostrar imagen 4' }).click();
    await expect(carousel.locator('[data-active="true"]')).toHaveAttribute(
      'aria-label',
      '4 de 4',
    );

    await page.getByRole('button', { name: 'Siguiente imagen' }).click();
    await expect(carousel.locator('[data-active="true"]')).toHaveAttribute(
      'aria-label',
      '1 de 4',
    );

    const viewport = carousel.locator('.snap-mandatory');
    await expect
      .poll(() => viewport.evaluate((element) => Math.round(element.scrollLeft)))
      .toBe(0);
    await viewport.evaluate((element) => {
      element.scrollTo({ left: element.clientWidth * 2 });
    });
    await expect(carousel.locator('[data-active="true"]')).toHaveAttribute(
      'aria-label',
      '3 de 4',
    );

    const geometry = await carousel.evaluate((element) => {
      const viewportElement = element.querySelector('.snap-mandatory');
      const image = element.querySelector('[data-active="true"] img');
      if (!(viewportElement instanceof HTMLElement) || !(image instanceof HTMLImageElement)) {
        return null;
      }
      const viewportRect = viewportElement.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.pageOverflows).toBe(false);
    expect(Math.abs((geometry?.viewportWidth ?? 0) - (geometry?.viewportHeight ?? 0))).toBeLessThan(2);
    expect(Math.abs((geometry?.imageWidth ?? 0) - (geometry?.imageHeight ?? 0))).toBeLessThan(2);
  });
});
