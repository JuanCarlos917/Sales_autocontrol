import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — confirmar compra con pago dividido desde el modal', () => {
  test('NEGOCIANDO → COMPRADO pagando efectivo + transferencia descuenta de ambas cuentas', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);

    const plate = `MIX${Date.now().toString().slice(-6)}`;
    const PRICE = 25_000_000;
    const CASH = 15_000_000;
    const TRANSFER = 10_000_000;

    const vehicle = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      negotiatedValue: PRICE,
    });

    await page.goto(`/vehicles/${vehicle.id}?edit=true`);

    await page.getByTestId('vehicle-form-stage').selectOption('COMPRADO');
    await page.getByTestId('vehicle-form-purchase-price').fill(String(PRICE));

    await page.getByPlaceholder('Seleccionar proveedor...').click();
    await page.getByRole('button', { name: /Proveedor Test/ }).first().click();

    await page.getByTestId('vehicle-form-cash-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('vehicle-form-cash-amount').fill(String(CASH));
    await page.getByTestId('vehicle-form-transfer-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('vehicle-form-transfer-amount').fill(String(TRANSFER));

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

    const cashAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);
    expect(cashBefore - cashAfter).toBe(CASH);
    expect(bankBefore - bankAfter).toBe(TRANSFER);
  });
});
