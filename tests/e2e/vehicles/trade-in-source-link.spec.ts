import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiGetVehicle,
  apiMoveStage,
  apiRegisterSale,
  apiUpdateVehicleRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';
import { pgQuery } from '../../helpers/db';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function sellWithTradeIn(token: string, tradeInPlate: string) {
  const sold = await apiCreateVehicle(token, {
    plate: plate('SRC'),
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  const res = await apiRegisterSale(token, sold.id, {
    salePrice: 40_000_000,
    paymentType: 'TRADE_IN',
    buyerId: TEST_SEED_IDS.buyer,
    tradeIn: { plate: tradeInPlate, value: 15_000_000, brand: 'Mazda', model: '3', year: 2019 },
  });
  return { sourceId: sold.id, tradeInId: res.newVehicle!.id };
}

test.describe('Vehículos — cruce con vínculo fuerte al origen', () => {
  test('registerSale con tradeIn deja supplierId=buyerId y sourceVehicleId=origen', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const { sourceId, tradeInId } = await sellWithTradeIn(token, plate('LNK'));

    const cruce = await apiGetVehicle(token, tradeInId);
    expect(cruce.fromTradeIn).toBe(true);
    expect(cruce.sourceVehicleId).toBe(sourceId);
    expect(cruce.supplierId).toBe(TEST_SEED_IDS.buyer);
  });

  test('al pasar el cruce a ALISTAMIENTO no exige proveedor adicional', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const { tradeInId } = await sellWithTradeIn(token, plate('ADV'));

    await apiMoveStage(token, tradeInId, 'COMPRADO');
    // ALISTAMIENTO antes de este fix tronaba con "Debe asignar un proveedor".
    const after = await apiMoveStage(token, tradeInId, 'ALISTAMIENTO');
    expect(after.stage).toBe('ALISTAMIENTO');
  });

  test('un cruce no admite socio: PUT con partnerId devuelve 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const { tradeInId } = await sellWithTradeIn(token, plate('NSO'));

    const res = await apiUpdateVehicleRaw(token, tradeInId, {
      partnerId: TEST_SEED_IDS.employee, // cualquier tercero válido, lo importante es el rechazo
    } as never);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cruce.*no admite socio/i);
  });

  test('el comprador (CLIENT) se auto-upgrade a BOTH al volverse proveedor del cruce', async ({ page }) => {
    const token = await loginAsAdmin(page);

    // Los third_parties son seed y no se truncan entre tests: forzamos CLIENT
    // para no acoplar este test al orden de ejecución dentro del archivo.
    await pgQuery(`UPDATE third_parties SET type = 'CLIENT' WHERE id = $1`, [TEST_SEED_IDS.buyer]);

    await sellWithTradeIn(token, plate('UPG'));

    const afterRows = await pgQuery<{ type: string }>(
      `SELECT type FROM third_parties WHERE id = $1`,
      [TEST_SEED_IDS.buyer],
    );
    expect(afterRows[0]?.type).toBe('BOTH');
  });
});
