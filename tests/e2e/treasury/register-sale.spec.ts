import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';
import { apiCreateVehicle, apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — registrar venta desde Kanban', () => {
  test('drag a VENDIDO con pago efectivo: vehículo queda en VENDIDO y cuenta refleja el ingreso', async ({ page }) => {
    const plate = `SEL${Date.now().toString().slice(-7)}`;
    const SALE_AMOUNT = 22_000_000;

    const token = await loginAsAdmin(page);

    const beforeAccount = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const beforeBalance = parseFloat(beforeAccount.currentBalance as string);

    await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      brand: 'Chevrolet',
      model: 'Spark',
      year: 2020,
      negotiatedValue: 18000000,
      purchasePrice: 18000000,
      listedPrice: 22000000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await page.reload();
    await expect(
      page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible({ timeout: 10_000 });

    await html5DragAndDrop(
      page,
      `[data-testid="vehicle-card-${plate}"]`,
      `[data-testid="kanban-column-VENDIDO"]`,
    );

    // Step 1: precio + tipo de pago
    const salePriceInput = page.getByTestId('sale-price');
    await expect(salePriceInput).toBeVisible({ timeout: 5_000 });
    await salePriceInput.fill('22000000');
    await page.getByTestId('sale-payment-type-CASH').click();

    // Step 2: cuenta + monto + cliente
    await page.getByTestId('sale-cash-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('sale-cash-amount').fill('22000000');

    await page.getByPlaceholder('Seleccionar cliente...').click();
    await page.getByRole('button', { name: /Cliente Test/ }).first().click();

    await page.getByTestId('sale-submit').click();

    await expect(
      page.getByTestId('kanban-column-VENDIDO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`),
    ).toHaveCount(0);

    const afterAccount = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const afterBalance = parseFloat(afterAccount.currentBalance as string);
    expect(afterBalance - beforeBalance).toBe(SALE_AMOUNT);
  });
});
