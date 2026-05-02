import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';

async function createVehicle(page: import('@playwright/test').Page, plate: string, negotiatedValue?: string) {
  await page.getByTestId('kanban-create-vehicle').click();
  await page.getByTestId('vehicle-form-plate').fill(plate);
  if (negotiatedValue) {
    await page.getByTestId('vehicle-form-negotiated-value').fill(negotiatedValue);
  }
  await page.getByTestId('vehicle-form-submit').click();
  await expect(page.getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
}

test.describe('Vehículos — mover NEGOCIANDO → COMPRADO', () => {
  test('con Valor Negociado: drop mueve el vehículo a COMPRADO', async ({ page }) => {
    await loginAsAdmin(page);

    const plate = `MOV${Date.now().toString().slice(-7)}`;
    await createVehicle(page, plate, '20000000');

    const negotiating = page.getByTestId('kanban-column-NEGOCIANDO');
    const purchased = page.getByTestId('kanban-column-COMPRADO');

    await expect(negotiating.getByTestId(`vehicle-card-${plate}`)).toBeVisible();

    await html5DragAndDrop(
      page,
      `[data-testid="vehicle-card-${plate}"]`,
      `[data-testid="kanban-column-COMPRADO"]`,
    );

    await expect(purchased.getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
    await expect(negotiating.getByTestId(`vehicle-card-${plate}`)).toHaveCount(0);
  });

  test('sin Valor Negociado: muestra alerta de validación y no mueve', async ({ page }) => {
    await loginAsAdmin(page);

    const plate = `INV${Date.now().toString().slice(-7)}`;
    await createVehicle(page, plate);

    const negotiating = page.getByTestId('kanban-column-NEGOCIANDO');
    const purchased = page.getByTestId('kanban-column-COMPRADO');

    await html5DragAndDrop(
      page,
      `[data-testid="vehicle-card-${plate}"]`,
      `[data-testid="kanban-column-COMPRADO"]`,
    );

    await expect(page.getByText(/Valor Negociado requerido/i)).toBeVisible({ timeout: 5_000 });
    await expect(negotiating.getByTestId(`vehicle-card-${plate}`)).toBeVisible();
    await expect(purchased.getByTestId(`vehicle-card-${plate}`)).toHaveCount(0);
  });
});
