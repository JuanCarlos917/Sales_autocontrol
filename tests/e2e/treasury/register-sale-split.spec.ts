import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';
import { apiCreateVehicle, apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — venta Mixto con pago dividido desde el modal', () => {
  test('Mixto: efectivo + transferencia ingresa a ambas cuentas y el vehículo queda VENDIDO', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);

    const plate = `SMX${Date.now().toString().slice(-6)}`;
    await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 18_000_000,
      purchasePrice: 18_000_000,
      listedPrice: 22_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await page.reload();
    await expect(page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });

    await html5DragAndDrop(page, `[data-testid="vehicle-card-${plate}"]`, `[data-testid="kanban-column-VENDIDO"]`);

    await page.getByTestId('sale-price').fill('22000000');
    await page.getByTestId('sale-payment-type-MIXED').click();

    await page.getByTestId('sale-mixed-cash-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('sale-mixed-cash-amount').fill('12000000');
    await page.getByTestId('sale-mixed-transfer-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('sale-mixed-transfer-amount').fill('10000000');

    await page.getByPlaceholder('Seleccionar cliente...').click();
    await page.getByRole('button', { name: /Cliente Test/ }).first().click();

    await page.getByTestId('sale-submit').click();

    await expect(page.getByTestId('kanban-column-VENDIDO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });

    const cashAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);
    // Después del fix de comisiones (PR #28), saleService transfiere
    // reinvest + tax desde el primer cashPayment (la cuenta cash). Sale = 22M,
    // compra = 18M, ganancia bruta = 4M → reinvest 30% = 1.2M, tax 10% = 0.4M.
    // Cash recibe los 12M de la venta pero pierde 1.6M en transfers → +10.4M neto.
    // Bank no se ve afectado por las transfers automáticas.
    const profit = 22_000_000 - 18_000_000;
    const reinvest = profit * 0.30;
    const tax = profit * 0.10;
    expect(cashAfter - cashBefore).toBeCloseTo(12_000_000 - reinvest - tax, 0);
    expect(bankAfter - bankBefore).toBe(10_000_000);
  });
});
