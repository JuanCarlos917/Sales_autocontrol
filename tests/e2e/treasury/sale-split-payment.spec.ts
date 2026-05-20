import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRegisterSale, apiGetAccount, apiGetVehiclePaymentStatus } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — venta mixta con pago dividido (efectivo + transferencia)', () => {
  test('venta mixta ingresa a ambas cuentas por separado y deja el resto como CxC', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);

    const plate = `SAL${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, { plate, negotiatedValue: 18_000_000, supplierId: TEST_SEED_IDS.supplier });

    // Vende en 30M: 12M efectivo + 10M transferencia → CxC 8M
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayments: [
        { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000, method: 'CASH' },
        { accountId: TEST_SEED_IDS.accountBank, amount: 10_000_000, method: 'TRANSFER' },
      ],
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(status.sale).not.toBeNull();
    expect(parseFloat(String(status.sale!.paidAmount))).toBe(22_000_000);
    expect(status.sale!.pendingAmount).toBe(8_000_000);
    expect(status.sale!.status).toBe('PARTIAL');

    const cashAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);
    expect(cashAfter - cashBefore).toBe(12_000_000);
    expect(bankAfter - bankBefore).toBe(10_000_000);
  });
});
