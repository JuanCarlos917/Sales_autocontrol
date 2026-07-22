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
  apiGetSocioPending,
  apiConfirmPurchase,
  apiUpdateCommissionConfig,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Campos legacy que el schema Joi de PUT /settings/commission-config sigue
// exigiendo como `required()` — mismo bloque base que cuentas-socio.spec.ts.
const BASE_COMMISSION_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

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

    // Comisión primero (afterCommission = gross − commissionPool = 10M − 1M =
    // 9M), luego reservas sobre ESE neto: reinvest 30% = 2.7M, tax 10% = 0.9M.
    // Ganancia del socio = afterCommission − reservas = 9M − 2.7M − 0.9M = 5.4M
    // (neta de comisión: la comisión ya no se resta de partnerProfit, se
    // adeuda aparte y se devuelve al fondo vía CxP COMMISSION_RETURN — Modelo B).
    expect(sale.summary.socioShare).toBe(1);
    expect(sale.summary.reinvestAmount).toBe(2_700_000);
    expect(sale.summary.taxAmount).toBe(900_000);
    expect(sale.summary.partnerProfit).toBe(5_400_000);
    expect(sale.summary.partnerCommissionOwed).toBe(1_000_000);
    expect(sale.summary.profitToDistribute).toBe(0);
    expect(sale.summary.investors ?? []).toHaveLength(0);

    const payables = await apiListPayables(token, { vehicleId: v.id });
    const partnerShare = payables.find((pb) => pb.type === 'PARTNER_SHARE');
    expect(Number(partnerShare?.totalAmount)).toBe(5_400_000);

    // Inversionista 100%: el pool de comisión se deposita en la cuenta del
    // socio como CxP COMMISSION_RETURN (no se crea la CxC RECEIVABLE del
    // modelo de socio externo).
    const commissionReturn = payables.find((pb) => pb.type === 'COMMISSION_RETURN');
    expect(Number(commissionReturn?.totalAmount)).toBe(1_000_000);
    expect(payables.some((pb) => pb.type === 'RECEIVABLE')).toBe(false);

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

  test('widget socio: el endpoint /socio-pending refleja pagar la ganancia y cobrar la comisión', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SPW'), {
      partnerId: TEST_SEED_IDS.partner,
      participation: 0.6,
    });
    await sellSocioVehicleCash(token, v.id);

    // Ambos buckets listan este vehículo.
    const before = await apiGetSocioPending(token);
    const gRow = before.profit.items.find((it) => it.vehicleId === v.id);
    const cRow = before.commission.items.find((it) => it.vehicleId === v.id);
    expect(gRow).toBeTruthy();
    expect(cRow).toBeTruthy();
    expect(gRow!.pending).toBeGreaterThan(0);
    expect(cRow!.pending).toBeGreaterThan(0);

    // Pagar la ganancia (PARTNER_SHARE) → sale del bucket de ganancia.
    const payG = await apiRequestRaw('POST', `/payables/${gRow!.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: gRow!.pending,
      description: 'Pago ganancia socio (widget)',
    });
    expect(payG.status).toBe(201);

    const afterG = await apiGetSocioPending(token);
    expect(afterG.profit.items.some((it) => it.vehicleId === v.id)).toBe(false);
    // La comisión sigue pendiente.
    expect(afterG.commission.items.some((it) => it.vehicleId === v.id)).toBe(true);

    // Cobrar la comisión (RECEIVABLE) → sale del bucket de comisión.
    const payC = await apiRequestRaw('POST', `/payables/${cRow!.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: cRow!.pending,
      description: 'Cobro comisión socio (widget)',
    });
    expect(payC.status).toBe(201);

    const afterC = await apiGetSocioPending(token);
    expect(afterC.commission.items.some((it) => it.vehicleId === v.id)).toBe(false);
  });

  test('Modelo B: round-trip inversionista 100% — capital vuelve a la cuenta del socio', async () => {
    const token = await apiPinLogin();

    // Inversionista 100% con cuenta SOCIO real: resolveSocio (commissionService)
    // sólo trata como inversionista a 'owner-self' o a quien esté en
    // investor_team; owner-self (usado en "socio inversionista al 100%" arriba)
    // no tiene cuenta SOCIO sembrada en el seed, así que aquí usamos
    // TEST_SEED_IDS.partner (sí tiene cuenta SOCIO sembrada,
    // TEST_SEED_IDS.partnerAccount) y lo incorporamos temporalmente al
    // investor_team — mismo patrón que cuentas-socio.spec.ts (try/finally
    // restaura, porque settings no se trunca entre tests).
    const cfgRes = await apiUpdateCommissionConfig(token, {
      ...BASE_COMMISSION_CFG,
      investor_team: [{ thirdPartyId: TEST_SEED_IDS.partner, sharePct: 100 }],
    });
    expect(cfgRes.status).toBe(200);

    try {
      // Fondear la cuenta SOCIO con el aporte que va a poner en la compra: la
      // compra real (confirm-purchase) saca el aporte de esa cuenta.
      const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
        fromAccountId: TEST_SEED_IDS.accountCash,
        toAccountId: TEST_SEED_IDS.partnerAccount,
        amount: SOCIO_PURCHASE_PRICE,
      });
      expect(fund.status).toBe(201);

      const p = plate('MB');
      const v = await apiCreateVehicle(token, {
        plate: p,
        stage: 'NEGOCIANDO',
        negotiatedValue: SOCIO_PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
      });

      // Compra: el socio aporta el 100% desde su cuenta SOCIO
      // (partnerContribution === purchasePrice → participation se
      // auto-calcula en 0 → socioShare 1 en la cascada de venta).
      await apiConfirmPurchase(token, v.id, {
        vehicle: {
          purchasePrice: SOCIO_PURCHASE_PRICE,
          supplierId: TEST_SEED_IDS.supplier,
          partnerId: TEST_SEED_IDS.partner,
          partnerContribution: SOCIO_PURCHASE_PRICE,
        },
        payment: {},
      });

      const sale = await apiRegisterSale(token, v.id, {
        salePrice: SOCIO_SALE_PRICE,
        paymentType: 'CASH',
        buyerId: TEST_SEED_IDS.buyer,
        cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SOCIO_SALE_PRICE },
        participants: saleParticipants(),
      });
      expect(sale.summary.socioShare).toBe(1);

      const pend = await apiGetSocioPending(token);
      const cap = pend.capital.items.find((it) => it.vehicleId === v.id);
      const prof = pend.profit.items.find((it) => it.vehicleId === v.id);
      expect(cap).toBeTruthy();
      expect(prof).toBeTruthy();
      expect(cap!.pending).toBe(SOCIO_PURCHASE_PRICE); // capital = aporte del socio

      // Pagar la devolución de capital desde una cuenta de empresa → entra a
      // la cuenta socio (enrutamiento FASE B, igual que PARTNER_SHARE).
      const socioBefore = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
      const payCap = await apiRequestRaw('POST', `/payables/${cap!.id}/payments`, token, {
        accountId: TEST_SEED_IDS.accountCash,
        amount: cap!.pending,
        description: 'Devolución capital (round-trip)',
      });
      expect(payCap.status).toBe(201);
      const body = payCap.body as { transaction?: { category?: string; type?: string } };
      expect(body.transaction?.category).toBe('CAPITAL_RETURN');
      expect(body.transaction?.type).toBe('EXPENSE');

      const socioAfter = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
      expect(Number(socioAfter.currentBalance)).toBe(Number(socioBefore.currentBalance) + SOCIO_PURCHASE_PRICE);

      // Ya no aparece en el bucket capital.
      const pend2 = await apiGetSocioPending(token);
      expect(pend2.capital.items.some((it) => it.vehicleId === v.id)).toBe(false);
    } finally {
      // Restaurar investor_team para no contaminar otros tests del archivo
      // (settings no se trunca entre tests).
      await apiUpdateCommissionConfig(token, { ...BASE_COMMISSION_CFG, investor_team: [] });
    }
  });

  test('Modelo B: round-trip inversionista 100% — capital, ganancia y comisión vuelven a la cuenta del socio; la comisión del vendedor se paga desde ahí', async () => {
    const token = await apiPinLogin();

    // Mismo patrón que "Modelo B: round-trip ... capital vuelve a la cuenta del
    // socio": TEST_SEED_IDS.partner sí tiene cuenta SOCIO sembrada
    // (TEST_SEED_IDS.partnerAccount); se incorpora temporalmente al
    // investor_team para que resolveSocio lo trate como inversionista 100%.
    const cfgRes = await apiUpdateCommissionConfig(token, {
      ...BASE_COMMISSION_CFG,
      investor_team: [{ thirdPartyId: TEST_SEED_IDS.partner, sharePct: 100 }],
    });
    expect(cfgRes.status).toBe(200);

    try {
      // Fondear la cuenta SOCIO con el aporte que va a poner en la compra.
      const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
        fromAccountId: TEST_SEED_IDS.accountCash,
        toAccountId: TEST_SEED_IDS.partnerAccount,
        amount: SOCIO_PURCHASE_PRICE,
      });
      expect(fund.status).toBe(201);

      const p = plate('CR');
      const v = await apiCreateVehicle(token, {
        plate: p,
        stage: 'NEGOCIANDO',
        negotiatedValue: SOCIO_PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
      });

      // Compra: el socio aporta el 100% desde su cuenta SOCIO.
      await apiConfirmPurchase(token, v.id, {
        vehicle: {
          purchasePrice: SOCIO_PURCHASE_PRICE,
          supplierId: TEST_SEED_IDS.supplier,
          partnerId: TEST_SEED_IDS.partner,
          partnerContribution: SOCIO_PURCHASE_PRICE,
        },
        payment: {},
      });

      const socioBefore = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
      const before = Number(socioBefore.currentBalance);

      // Venta con un único vendedor (test-tp-employee) al 100% de la comisión.
      const sale = await apiRegisterSale(token, v.id, {
        salePrice: SOCIO_SALE_PRICE,
        paymentType: 'CASH',
        buyerId: TEST_SEED_IDS.buyer,
        cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SOCIO_SALE_PRICE },
        participants: saleParticipants(),
      });
      expect(sale.summary.socioShare).toBe(1);

      // Los 3 buckets del socio traen filas para este vehículo: capital
      // (aporte devuelto), ganancia (PARTNER_SHARE, neta de comisión) y la
      // comisión que el fondo adelantó a los vendedores (COMMISSION_RETURN).
      const pend = await apiGetSocioPending(token);
      const cap = pend.capital.items.find((it) => it.vehicleId === v.id);
      const prof = pend.profit.items.find((it) => it.vehicleId === v.id);
      const comm = pend.commissionReturn.items.find((it) => it.vehicleId === v.id);
      expect(cap).toBeTruthy();
      expect(prof).toBeTruthy();
      expect(comm).toBeTruthy();
      expect(cap!.pending).toBe(SOCIO_PURCHASE_PRICE);

      // Depositar capital + ganancia + comisión a la cuenta del socio (FASE B,
      // desde la caja de la empresa) — no se hardcodean montos derivados de
      // porcentajes: sólo se verifican relaciones entre buckets y saldos.
      for (const it of [cap!, prof!, comm!]) {
        const r = await apiRequestRaw('POST', `/payables/${it.id}/payments`, token, {
          accountId: TEST_SEED_IDS.accountCash,
          amount: it.pending,
          description: 'Depósito socio (round-trip comisión)',
        });
        expect(r.status).toBe(201);
      }

      const commTx = comm!.pending;
      const socioAfterDeposits = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
      expect(Number(socioAfterDeposits.currentBalance)).toBe(before + cap!.pending + prof!.pending + commTx);

      // El pool de comisión depositado debe coincidir exactamente con lo que
      // el fondo adeuda a los vendedores de este vehículo (CxP COMMISSION).
      const sellerPayables = await apiListPayables(token, { type: 'COMMISSION', vehicleId: v.id });
      expect(sellerPayables.length).toBeGreaterThan(0);
      const sellerTotal = sellerPayables.reduce((s, pb) => s + (Number(pb.totalAmount) - Number(pb.paidAmount)), 0);
      expect(sellerTotal).toBe(commTx);

      // Pagar la comisión del vendedor DESDE la cuenta del socio (único
      // egreso de esa cuenta; el vendedor no tiene cuenta SOCIO, así que no
      // hay reenrutamiento FASE B — el dinero sale directo de la cuenta socio).
      for (const pb of sellerPayables) {
        const pendingAmount = Number(pb.totalAmount) - Number(pb.paidAmount);
        if (pendingAmount <= 0) continue;
        const r = await apiRequestRaw('POST', `/payables/${pb.id}/payments`, token, {
          accountId: TEST_SEED_IDS.partnerAccount,
          amount: pendingAmount,
          description: 'Comisión vendedor pagada desde cuenta socio',
        });
        expect(r.status).toBe(201);
      }

      // Neto: la comisión entró y salió de la cuenta del socio → sólo queda
      // capital + ganancia.
      const socioAfterPay = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
      expect(Number(socioAfterPay.currentBalance)).toBe(before + cap!.pending + prof!.pending);

      // Ya no queda comisión por depositar para este vehículo.
      const pend2 = await apiGetSocioPending(token);
      expect(pend2.commissionReturn.items.some((it) => it.vehicleId === v.id)).toBe(false);
    } finally {
      // Restaurar investor_team para no contaminar otros tests del archivo
      // (settings no se trunca entre tests).
      await apiUpdateCommissionConfig(token, { ...BASE_COMMISSION_CFG, investor_team: [] });
    }
  });
});
