import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';
import {
  apiCreateVehicle,
  apiRegisterSale,
  apiGetVehicle,
  apiMoveStage,
  apiGetVehiclePaymentStatus,
  apiGetAccount,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

async function sellWithTradeIn(token: string) {
  const sold = await apiCreateVehicle(token, {
    plate: `SLD${Date.now().toString().slice(-6)}`,
    stage: 'COMPRADO',
    negotiatedValue: 18_000_000,
    purchasePrice: 18_000_000,
    listedPrice: 25_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  const res = await apiRegisterSale(token, sold.id, {
    salePrice: 25_000_000,
    paymentType: 'TRADE_IN',
    buyerId: TEST_SEED_IDS.buyer,
    tradeIn: { plate: `CRU${Date.now().toString().slice(-6)}`, value: 10_000_000, brand: 'Mazda', model: '3', year: 2019 },
    financing: { notes: 'saldo a cobrar' },
  });
  return res.newVehicle!.id;
}

test.describe('Vehículos — cruce recibido entra a NEGOCIANDO', () => {
  test('el vehículo recibido en cruce nace en NEGOCIANDO con valor negociado = cruce, sin compra registrada', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const newId = await sellWithTradeIn(token);

    const nv = await apiGetVehicle(token, newId);
    expect(nv.stage).toBe('NEGOCIANDO');
    expect(parseFloat(String(nv.negotiatedValue))).toBe(10_000_000);
    expect(nv.fromTradeIn).toBe(true);
    expect(nv.purchasePrice).toBeNull();

    // Compra diferida: aún no hay CxP de compra
    const status = await apiGetVehiclePaymentStatus(token, newId);
    expect(status.purchase).toBeNull();
  });

  test('al pasar a COMPRADO la compra queda saldada por el cruce (precio = cruce, sin egreso)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const newId = await sellWithTradeIn(token);

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);

    await apiMoveStage(token, newId, 'COMPRADO');

    const nv = await apiGetVehicle(token, newId);
    expect(nv.stage).toBe('COMPRADO');
    expect(parseFloat(String(nv.purchasePrice))).toBe(10_000_000);

    const status = await apiGetVehiclePaymentStatus(token, newId);
    expect(status.purchase).not.toBeNull();
    expect(status.purchase!.status).toBe('PAID');
    expect(status.purchase!.pendingAmount).toBe(0);

    // Saldada por el cruce: ninguna cuenta de tesorería se movió al avanzar
    const cashAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);
    const bankAfter = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string);
    expect(cashAfter).toBe(cashBefore);
    expect(bankAfter).toBe(bankBefore);

    // El contador de la pestaña Tesorería cuenta la CxP aunque no haya movimiento de caja
    await page.goto(`/vehicles/${newId}`);
    await expect(page.getByTestId('vehicle-tab-tesoreria')).toContainText('Tesoreria (1)', { timeout: 10_000 });
  });

  test('COMPRADO→ALISTAMIENTO avanza directo (proveedor ya viene auto-asignado del cruce)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const newId = await sellWithTradeIn(token);
    await apiMoveStage(token, newId, 'COMPRADO');
    const nv = await apiGetVehicle(token, newId);
    const plate = nv.plate;

    await page.goto('/');
    await expect(page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });

    await html5DragAndDrop(page, `[data-testid="vehicle-card-${plate}"]`, `[data-testid="kanban-column-ALISTAMIENTO"]`);

    // El proveedor del cruce = comprador del carro origen, asignado por saleService.
    // Por eso ALISTAMIENTO debe avanzar sin abrir el formulario para pedir nada.
    await expect(page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
  });
});
