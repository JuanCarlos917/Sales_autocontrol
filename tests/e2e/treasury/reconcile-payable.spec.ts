import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiConfirmPurchase, apiListPayables, apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — conciliar CxP desde PayablesPage', () => {
  test('pagar el total de una CxP pendiente: status PAID y cuenta refleja el egreso', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const before = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const beforeBalance = parseFloat(before.currentBalance as string);

    const plate = `CXP${Date.now().toString().slice(-7)}`;
    const PURCHASE_PRICE = 15_000_000;

    const vehicle = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
    });

    await apiConfirmPurchase(token, vehicle.id, {
      vehicle: { purchasePrice: PURCHASE_PRICE, supplierId: TEST_SEED_IDS.supplier },
      payment: { thirdPartyId: TEST_SEED_IDS.supplier, dueDate: null },
    });

    const payables = await apiListPayables(token);
    const cxp = payables.find((p) => p.vehicleId === vehicle.id && p.type === 'PAYABLE');
    expect(cxp, 'Payable should exist after confirmPurchase without payment').toBeDefined();
    expect(cxp!.status).toBe('PENDING');

    await page.goto('/treasury/payables');
    const payButton = page.getByTestId(`payable-pay-${cxp!.id}`);
    await expect(payButton).toBeVisible({ timeout: 10_000 });

    await payButton.click();

    const accountSelect = page.getByTestId('payment-modal-account');
    await expect
      .poll(async () => await accountSelect.inputValue(), { timeout: 5_000 })
      .not.toBe('');

    await accountSelect.selectOption(TEST_SEED_IDS.accountCash);
    await expect(accountSelect).toHaveValue(TEST_SEED_IDS.accountCash);

    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes(`/payables/${cxp!.id}/payments`) && resp.status() < 400,
        { timeout: 10_000 },
      ),
      page.getByTestId('payment-modal-submit').click(),
    ]);

    await expect(page.getByTestId(`payable-pay-${cxp!.id}`)).toHaveCount(0, { timeout: 10_000 });

    const updated = await apiListPayables(token);
    const paid = updated.find((p) => p.id === cxp!.id);
    expect(paid?.status).toBe('PAID');
    expect(parseFloat(paid!.paidAmount as string)).toBe(PURCHASE_PRICE);

    const after = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    const afterBalance = parseFloat(after.currentBalance as string);
    expect(beforeBalance - afterBalance).toBe(PURCHASE_PRICE);
  });
});
