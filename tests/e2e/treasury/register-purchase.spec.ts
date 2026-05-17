import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — confirmar compra desde VehicleDetailPage', () => {
  test('NEGOCIANDO → COMPRADO con pago efectivo: vehículo avanza, cuenta refleja el egreso', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const before = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const beforeBalance = parseFloat(before.currentBalance as string);

    const plate = `BUY${Date.now().toString().slice(-7)}`;
    const PURCHASE_PRICE = 18_000_000;

    const vehicle = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      brand: 'Renault',
      model: 'Sandero',
      year: 2021,
      negotiatedValue: PURCHASE_PRICE,
    });

    await page.goto(`/vehicles/${vehicle.id}?edit=true`);

    const stageSelect = page.getByTestId('vehicle-form-stage');
    await expect(stageSelect).toBeVisible({ timeout: 10_000 });
    await stageSelect.selectOption('COMPRADO');

    const priceInput = page.getByTestId('vehicle-form-purchase-price');
    await expect(priceInput).toBeVisible({ timeout: 5_000 });
    await priceInput.fill(String(PURCHASE_PRICE));

    await page.getByPlaceholder('Seleccionar proveedor...').click();
    await page.getByRole('button', { name: /Proveedor Test/ }).first().click();

    const accountSelect = page.getByTestId('vehicle-form-payment-account');
    await expect(accountSelect).toBeVisible({ timeout: 5_000 });
    await accountSelect.selectOption(TEST_SEED_IDS.accountCash);

    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/confirm-purchase') && resp.status() === 200,
        { timeout: 10_000 },
      ),
      page.getByTestId('vehicle-form-submit').click(),
    ]);

    await page.goto('/');
    await expect(
      page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible({ timeout: 10_000 });

    const after = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const afterBalance = parseFloat(after.currentBalance as string);
    expect(beforeBalance - afterBalance).toBe(PURCHASE_PRICE);
  });
});
