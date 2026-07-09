import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRegisterSale, apiListCommissions } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function sellVehicle(token: string, plateStr: string, participants?: Array<{ thirdPartyId: string; role: 'CAPTADOR' | 'CERRADOR'; sharePct: number }>) {
  const v = await apiCreateVehicle(token, {
    plate: plateStr,
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  await apiRegisterSale(token, v.id, {
    salePrice: 40_000_000,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 40_000_000 },
    ...(participants ? { participants } : {}),
  });
  return v;
}

test.describe('Comisiones — página dedicada', () => {
  test('venta genera card con cascada y 2 roles; pagar CAPTADOR lo deja PAGADO con movimiento ligado a la placa', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const p = plate('COM');
    await sellVehicle(token, p);

    await page.goto('/treasury/commissions');
    await expect(page.getByTestId('commissions-page')).toBeVisible();
    const card = page.getByTestId(`commission-card-${p}`);
    await expect(card).toBeVisible();
    // Cascada: ganancia 10M (40M − 30M, sin gastos)
    await expect(card).toContainText('Ganancia');
    await expect(card).toContainText('10.000.000'); // grossProfit determinista del escenario
    await expect(page.getByTestId(`commission-role-${p}-CAPTADOR`)).toBeVisible();
    await expect(page.getByTestId(`commission-role-${p}-CERRADOR`)).toBeVisible();

    // Estado inicial: ambos roles Pendiente antes de pagar
    await expect(page.getByTestId(`commission-role-status-${p}-CAPTADOR`)).toContainText('Pendiente');
    await expect(page.getByTestId(`commission-role-status-${p}-CERRADOR`)).toContainText('Pendiente');

    // Pagar captador
    await page.getByTestId(`commission-pay-${p}-CAPTADOR`).click();
    await page.getByTestId('payment-modal-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('payment-modal-submit').click();

    await expect(page.getByTestId(`commission-role-status-${p}-CAPTADOR`)).toContainText('Pagado', { timeout: 10_000 });

    // Trazabilidad: movimiento COMMISSION con placa en Movimientos
    await page.goto('/treasury/transactions');
    await expect(page.getByText(`Comisión venta ${p} — CAPTADOR`).first()).toBeVisible();
  });

  test('venta con participantes custom crea CxPs a nombre del tercero con esos %', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const p = plate('CUS');
    await sellVehicle(token, p, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 40 },
      { thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: 60 },
    ]);

    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === p);
    expect(item).toBeTruthy();
    expect(item!.hasPending).toBe(true);
    const captador = item!.roles.find((r) => r.role === 'CAPTADOR');
    expect(captador?.thirdParty.id).toBe(TEST_SEED_IDS.employee);
    expect(captador?.sharePct).toBe(40);

    // Y la UI lo refleja
    await page.goto('/treasury/commissions');
    await expect(page.getByTestId(`commission-role-${p}-CAPTADOR`)).toContainText('40%');
    await expect(page.getByTestId(`commission-role-${p}-CAPTADOR`)).toContainText(captador!.thirdParty.name);
  });
});
