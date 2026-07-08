import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRegisterSale, apiMoveStage } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

// Vende un origen (compra 30M, venta 40M) recibiendo un cruce valorado en 15M.
async function sellSourceWithTradeIn(token: string, tradeInPlate: string) {
  const source = await apiCreateVehicle(token, {
    plate: plate('DLS'),
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  const res = await apiRegisterSale(token, source.id, {
    salePrice: 40_000_000,
    paymentType: 'MIXED',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
    tradeIn: { plate: tradeInPlate, value: 15_000_000, brand: 'Mazda', model: '3', year: 2019 },
  });
  return { source, tradeInId: res.newVehicle!.id };
}

test.describe('Pipeline — ganancia del negocio con cruce', () => {
  test('cadena viva: el origen difiere la ganancia al cruce', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const tiPlate = plate('TIA');
    const { source } = await sellSourceWithTradeIn(token, tiPlate);

    await page.goto('/');
    const card = page.getByTestId(`vehicle-card-${source.plate}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`deal-deferred-${source.plate}`)).toContainText(tiPlate);
  });

  test('cadena cerrada: la vitrina muestra la directa y el origen sigue diferido', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const tiPlate = plate('TIB');
    const { source, tradeInId } = await sellSourceWithTradeIn(token, tiPlate);

    // El cruce nace en NEGOCIANDO: confirmarlo como compra (saldada por cruce) y venderlo.
    await apiMoveStage(token, tradeInId, 'COMPRADO');
    await apiRegisterSale(token, tradeInId, {
      salePrice: 12_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000 },
    });

    await page.goto('/');
    // Directa del negocio: (40M − 30M) + (12M − 15M) = 7.000.000
    const showcase = page.getByTestId(`deal-profit-${tiPlate}`);
    await expect(showcase).toBeVisible();
    await expect(showcase).toContainText('7.000.000');
    // El origen NO muestra número: mantiene el diferimiento permanente.
    await expect(page.getByTestId(`deal-deferred-${source.plate}`)).toBeVisible();
    await expect(page.getByTestId(`deal-profit-${source.plate}`)).toHaveCount(0);
  });
});
