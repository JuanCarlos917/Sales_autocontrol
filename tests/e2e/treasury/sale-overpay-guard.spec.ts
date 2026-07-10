import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiCreateVehicle, apiRequestRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Hallazgo 🟠 #7 de la auditoría: registerSale aceptaba recibir MÁS que el
// precio de venta — el excedente entraba a caja sin aviso y pendingAmount
// negativo solo se clampeaba para display.

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function createVehicleForSale(token: string): Promise<string> {
  const v = await apiCreateVehicle(token, {
    plate: plate('OVP'),
    stage: 'COMPRADO',
    negotiatedValue: 8_000_000,
    purchasePrice: 8_000_000,
    listedPrice: 10_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  return v.id;
}

test.describe('Ventas — guard de sobre-recibido', () => {
  test('pago en efectivo mayor al precio de venta se rechaza', async () => {
    const token = await apiPinLogin();
    const vehicleId = await createVehicleForSale(token);
    const res = await apiRequestRaw('POST', `/vehicles/${vehicleId}/sell`, token, {
      salePrice: 10_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/super|exced/i);
  });

  test('efectivo + cruce que superan el precio de venta se rechaza', async () => {
    const token = await apiPinLogin();
    const vehicleId = await createVehicleForSale(token);
    const res = await apiRequestRaw('POST', `/vehicles/${vehicleId}/sell`, token, {
      salePrice: 10_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 8_000_000 },
      tradeIn: { plate: plate('TIX'), value: 5_000_000, brand: 'Mazda', model: '2', year: 2018 },
    });
    expect(res.status).toBe(400);
  });

  test('recibir exactamente el precio de venta sigue funcionando', async () => {
    const token = await apiPinLogin();
    const vehicleId = await createVehicleForSale(token);
    const res = await apiRequestRaw('POST', `/vehicles/${vehicleId}/sell`, token, {
      salePrice: 10_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 10_000_000 },
    });
    expect([200, 201]).toContain(res.status);
  });
});
