import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiRegisterSale,
  apiListPayables,
  apiListInvestors,
  apiGetPayablesSummary,
  apiGetVehiclePaymentStatus,
  apiRequestRaw,
  apiGetAccount,
  apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Cascada del socio (resolveSocio + calculateSaleDistribution, Task 2/3): un
// vehículo comprado con socio (partnerId + participation, donde
// socioShare = 1 − participation) reparte la venta así:
//   grossProfit → comisión sobre bruto (vendedores) → el socio se lleva su
//   % de la ganancia bruta (PARTNER_SHARE) y adeuda su % de la comisión al
//   fondo (CxC "Comisión socio") → reservas (reinversión/impuestos) sólo
//   sobre la parte del fondo → PROFIT_SHARE se reparte entre inversionistas
//   únicamente sobre lo que le queda al fondo.
// Números fijos usados en todo el spec: compra 20M, venta 30M (gross 10M),
// comisión 10% del gross (vendedor único 100%), reinversión 30% / impuestos
// 10% sobre la base que corresponda.

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

const SOCIO_PURCHASE_PRICE = 20_000_000;
const SOCIO_SALE_PRICE = 30_000_000;

/** Compra un vehículo con socio (partnerId + participation ya resuelta). */
async function buyVehicleWithSocio(
  token: string,
  plateStr: string,
  opts: { partnerId: string; participation: number },
) {
  return apiCreateVehicle(token, {
    plate: plateStr,
    stage: 'COMPRADO',
    negotiatedValue: SOCIO_PURCHASE_PRICE,
    purchasePrice: SOCIO_PURCHASE_PRICE,
    listedPrice: SOCIO_SALE_PRICE,
    supplierId: TEST_SEED_IDS.supplier,
    partnerId: opts.partnerId,
    participation: opts.participation,
  });
}

/** Vende de contado (CASH, monto exacto → sin saldo pendiente) con un único vendedor al 100%. */
async function sellSocioVehicleCash(token: string, vehicleId: string) {
  return apiRegisterSale(token, vehicleId, {
    salePrice: SOCIO_SALE_PRICE,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SOCIO_SALE_PRICE },
    participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
  });
}

function saleParticipants() {
  return [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR' as const, sharePct: 100 }];
}

test.describe('Socio del vehículo (partnerId/participation) en la cascada de venta', () => {
  test('socio externo 40%: PARTNER_SHARE, comisión pendiente, reservas del fondo y exclusión de Inversionistas', async () => {
    const token = await apiPinLogin();
    const p = plate('SOE');
    const beforeSummary = await apiGetPayablesSummary(token);

    // purchasePrice 20M, partnerContribution 40% → participation 0.6 (fondo),
    // socioShare 0.4 (externo, no inversionista).
    const v = await buyVehicleWithSocio(token, p, { partnerId: TEST_SEED_IDS.partner, participation: 0.6 });
    const sale = await sellSocioVehicleCash(token, v.id);

    // Cascada: gross 10M → comisión 10% = 1M → neto 9M. Fondo 60% de 9M = 5.4M
    // → reinvest 30% = 1.62M, tax 10% = 0.54M → PROFIT_SHARE fondo = 3.24M.
    // Socio: ganancia bruta 40% de 10M = 4M; comisión adeudada 40% de 1M = 400k.
    expect(sale.summary.grossProfit).toBe(10_000_000);
    expect(sale.summary.commissionPool).toBe(1_000_000);
    expect(sale.summary.partnerProfit).toBe(4_000_000);
    expect(sale.summary.partnerCommissionOwed).toBe(400_000);
    expect(sale.summary.socioShare).toBe(0.4);
    expect(sale.summary.reinvestAmount).toBe(1_620_000);
    expect(sale.summary.taxAmount).toBe(540_000);
    expect(sale.summary.profitToDistribute).toBe(3_240_000);

    const payables = await apiListPayables(token, { vehicleId: v.id });

    const partnerShare = payables.find((pb) => pb.type === 'PARTNER_SHARE');
    expect(partnerShare).toBeTruthy();
    expect(Number(partnerShare!.totalAmount)).toBe(4_000_000);
    expect(partnerShare!.thirdPartyId).toBe(TEST_SEED_IDS.partner);
    expect(partnerShare!.description).toBe(`Ganancia socio venta ${p}`);

    // Única CxC RECEIVABLE del vehículo: la comisión del socio (venta de
    // contado sin saldo → no se crea CxC de venta).
    const socioReceivable = payables.find((pb) => pb.type === 'RECEIVABLE');
    expect(socioReceivable).toBeTruthy();
    expect(Number(socioReceivable!.totalAmount)).toBe(400_000);
    expect(socioReceivable!.thirdPartyId).toBe(TEST_SEED_IDS.partner);
    expect(socioReceivable!.description).toBe(`Comisión socio venta ${p}`);

    const profitShares = payables.filter((pb) => pb.type === 'PROFIT_SHARE');
    const fundTotal = profitShares.reduce((s, pb) => s + Number(pb.totalAmount), 0);
    expect(fundTotal).toBe(3_240_000);

    // El socio NO debe aparecer en la página de Inversionistas (su ganancia es
    // PARTNER_SHARE, no PROFIT_SHARE; no genera SaleParticipant de rol INVESTOR).
    const investorItems = await apiListInvestors(token);
    const item = investorItems.find((i) => i.vehicle.plate === p);
    expect(item).toBeTruthy();
    expect(item!.roles.some((r) => r.thirdParty.id === TEST_SEED_IDS.partner)).toBe(false);
    expect(item!.cascade.profitToDistribute).toBe(3_240_000);

    // payables/summary incluye la PARTNER_SHARE pendiente en el total.
    const afterSummary = await apiGetPayablesSummary(token);
    expect(afterSummary.payables.total).toBeGreaterThanOrEqual(beforeSummary.payables.total + 4_000_000);
  });

  test('socio inversionista al 100%: reparto al fondo es 0, reservas se calculan sobre todo', async () => {
    const token = await apiPinLogin();
    const p = plate('SOI');

    // owner-self como socio con participation 0 → socioShare 1 (inversionista 100%).
    const v = await buyVehicleWithSocio(token, p, { partnerId: 'owner-self', participation: 0 });
    const sale = await sellSocioVehicleCash(token, v.id);

    // Reservas sobre TODO el neto (9M): reinvest 30% = 2.7M, tax 10% = 0.9M.
    // Ganancia del socio = gross − reservas = 10M − 2.7M − 0.9M = 6.4M.
    // Comisión adeudada = 100% del pool = 1M. Fondo se queda con 0.
    expect(sale.summary.socioShare).toBe(1);
    expect(sale.summary.reinvestAmount).toBe(2_700_000);
    expect(sale.summary.taxAmount).toBe(900_000);
    expect(sale.summary.partnerProfit).toBe(6_400_000);
    expect(sale.summary.partnerCommissionOwed).toBe(1_000_000);
    expect(sale.summary.profitToDistribute).toBe(0);
    expect(sale.summary.investors ?? []).toHaveLength(0);

    const payables = await apiListPayables(token, { vehicleId: v.id });
    const partnerShare = payables.find((pb) => pb.type === 'PARTNER_SHARE');
    expect(Number(partnerShare?.totalAmount)).toBe(6_400_000);

    const socioReceivable = payables.find((pb) => pb.type === 'RECEIVABLE');
    expect(Number(socioReceivable?.totalAmount)).toBe(1_000_000);

    // Sin fila de PROFIT_SHARE: profitToDistribute === 0 no crea CxP vacías.
    const profitShares = payables.filter((pb) => pb.type === 'PROFIT_SHARE');
    expect(profitShares).toHaveLength(0);
  });

  test('pagar la CxP PARTNER_SHARE del socio categoriza la Transaction como PARTNER_SHARE (no VEHICLE_PURCHASE)', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOP'), { partnerId: TEST_SEED_IDS.partner, participation: 0.6 });
    await sellSocioVehicleCash(token, v.id);

    const payables = await apiListPayables(token, { vehicleId: v.id, type: 'PARTNER_SHARE' });
    expect(payables).toHaveLength(1);
    const partnerShare = payables[0];

    const pay = await apiRequestRaw('POST', `/payables/${partnerShare.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: Number(partnerShare.totalAmount),
      description: 'Pago ganancia socio',
    });
    expect(pay.status).toBe(201);

    const body = pay.body as { transaction?: { category?: string; type?: string } };
    expect(body.transaction?.category).toBe('PARTNER_SHARE');
    expect(body.transaction?.type).toBe('EXPENSE');

    const after = await apiListPayables(token, { vehicleId: v.id, type: 'PARTNER_SHARE' });
    expect(after[0].status).toBe('PAID');
  });

  test('venta de contado con socio no confunde la CxC de comisión del socio con un saldo pendiente de venta', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOD'), { partnerId: TEST_SEED_IDS.partner, participation: 0.6 });
    // Pago exacto al precio de venta → totalReceived === salePrice → sin CxC de venta.
    await sellSocioVehicleCash(token, v.id);

    // La única CxC RECEIVABLE del vehículo es la "Comisión socio venta ..."
    // (isSaleReceivable filtra por el prefijo "Venta vehículo"); sin la
    // disambiguación, esta vería erróneamente un saldo pendiente de 400k.
    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(status.sale).toBeNull();
  });

  test('validación: socio externo con 100% del vehículo es rechazado al vender (debe ser inversionista)', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOV'), { partnerId: TEST_SEED_IDS.partner, participation: 0 });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: SOCIO_SALE_PRICE,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SOCIO_SALE_PRICE },
      participants: saleParticipants(),
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/inversionista/i);
  });

  test('validación: socio inversionista con participación parcial es rechazado al vender (debe ser 100%)', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOW'), { partnerId: 'owner-self', participation: 0.5 });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: SOCIO_SALE_PRICE,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SOCIO_SALE_PRICE },
      participants: saleParticipants(),
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/100%/);
  });

  test('FASE B: pagar la ganancia del socio ENTRA a su cuenta SOCIO (egreso empresa + ingreso socio)', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOB'), {
      partnerId: TEST_SEED_IDS.partner,
      participation: 0.6,
    });
    await sellSocioVehicleCash(token, v.id);

    const payables = await apiListPayables(token, { vehicleId: v.id, type: 'PARTNER_SHARE' });
    expect(payables).toHaveLength(1);
    const partnerShare = payables[0];
    const amount = Number(partnerShare.totalAmount);

    const socioBefore = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    const balBefore = Number(socioBefore.currentBalance);

    const pay = await apiRequestRaw('POST', `/payables/${partnerShare.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash, // cuenta empresa (origen ≠ cuenta socio)
      amount,
      description: 'Pago ganancia socio FASE B',
    });
    expect(pay.status).toBe(201);

    // La transacción que salda la CxP sigue siendo el EGRESO categorizado.
    const body = pay.body as { transaction?: { category?: string; type?: string } };
    expect(body.transaction?.category).toBe('PARTNER_SHARE');
    expect(body.transaction?.type).toBe('EXPENSE');

    // La cuenta SOCIO subió por el monto pagado.
    const socioAfter = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    expect(Number(socioAfter.currentBalance)).toBe(balBefore + amount);

    // Y existe un INGRESO a la cuenta socio con categoría PARTNER_SHARE.
    const socioTxs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.partnerAccount });
    const ingreso = socioTxs.find(
      (t) => t.type === 'INCOME' && t.category === 'PARTNER_SHARE' && Number(t.amount) === amount,
    );
    expect(ingreso).toBeTruthy();
  });
});
