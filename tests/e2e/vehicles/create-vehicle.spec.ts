import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../../fixtures/auth';

test.describe('Vehículos — crear en NEGOCIANDO', () => {
  test('crea un vehículo nuevo y aparece en la columna NEGOCIANDO', async ({ page }) => {
    await loginAsAdmin(page);

    const plate = `E2E${Date.now().toString().slice(-7)}`;

    await page.getByTestId('kanban-create-vehicle').click();

    const plateInput = page.getByTestId('vehicle-form-plate');
    await expect(plateInput).toBeVisible();
    await plateInput.fill(plate);

    await page.getByTestId('vehicle-form-submit').click();

    const card = page.getByTestId(`vehicle-card-${plate}`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    const negotiatingColumn = page.getByTestId('kanban-column-NEGOCIANDO');
    await expect(negotiatingColumn.getByTestId(`vehicle-card-${plate}`)).toBeVisible();
  });

  test('rechaza submit sin placa', async ({ page }) => {
    await loginAsAdmin(page);

    await page.getByTestId('kanban-create-vehicle').click();
    await page.getByTestId('vehicle-form-submit').click();

    await expect(page.getByTestId('vehicle-form-plate')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
