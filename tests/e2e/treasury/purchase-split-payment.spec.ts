import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiConfirmPurchase, apiGetAccount, apiGetVehiclePaymentStatus } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — compra con pago dividido (efectivo + transferencia)', () => {
  test('confirmar compra pagando parte en efectivo y parte en transferencia descuenta de ambas cuentas y deja el resto como CxP', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);

    const plate = `SPL${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      negotiatedValue: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: { purchasePrice: 30_000_000, supplierId: TEST_SEED_IDS.supplier },
      payment: {
        payments: [
          { accountId: TEST_SEED_IDS.accountCash, amount: 10_000_000, method: 'CASH' },
          { accountId: TEST_SEED_IDS.accountBank, amount: 8_000_000, method: 'TRANSFER' },
        ],
      },
    });

    // CxP: pagado 18M, pendiente 12M, estado PARCIAL
    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(status.purchase).not.toBeNull();
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(18_000_000);
    expect(status.purchase!.pendingAmount).toBe(12_000_000);
    expect(status.purchase!.status).toBe('PARTIAL');

    // Cada cuenta refleja su egreso por separado
    const cashAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);
    expect(cashBefore - cashAfter).toBe(10_000_000);
    expect(bankBefore - bankAfter).toBe(8_000_000);
  });

  test('confirmar compra cubriendo el total con efectivo + transferencia deja la CxP en PAID', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `SPF${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      negotiatedValue: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: { purchasePrice: 20_000_000, supplierId: TEST_SEED_IDS.supplier },
      payment: {
        payments: [
          { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000, method: 'CASH' },
          { accountId: TEST_SEED_IDS.accountBank, amount: 8_000_000, method: 'TRANSFER' },
        ],
      },
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(20_000_000);
    expect(status.purchase!.pendingAmount).toBe(0);
    expect(status.purchase!.status).toBe('PAID');
  });
});
