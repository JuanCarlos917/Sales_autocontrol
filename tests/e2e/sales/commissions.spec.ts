import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetCommissionConfig,
  apiUpdateCommissionConfig,
  apiCreateVehicle,
  apiRegisterSale,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Comisiones — configuración global', () => {
  test('GET /settings/commission-config devuelve los 7 valores con cuentas hidratadas', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cfg = await apiGetCommissionConfig(token);

    expect(cfg.commission_share_pct).toBe('60');
    expect(cfg.reinvest_share_pct).toBe('30');
    expect(cfg.tax_share_pct).toBe('10');
    expect(cfg.default_captador_pct).toBe('30');
    expect(cfg.default_cerrador_pct).toBe('70');
    expect(cfg.reinvest_account_id).toBe('budget-reinvest');
    expect(cfg.tax_reserve_account_id).toBe('budget-tax');
    expect(cfg.reinvest_account?.type).toBe('BUDGET');
    expect(cfg.tax_reserve_account?.type).toBe('BUDGET');
  });

  test('PUT /settings/commission-config valida que los 3 bolsillos sumen 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 50,
      reinvest_share_pct: 30,
      tax_share_pct: 10,  // suma 90, debe fallar
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum|100|bolsillos/i);
  });

  test('PUT /settings/commission-config valida que captador+cerrador sumen 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 40,
      default_cerrador_pct: 50,  // suma 90, debe fallar
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/default.*100|captador.*cerrador/i);
  });

  test('PUT /settings/commission-config valida que las cuentas sean BUDGET', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // 'test-acc-cash' is a CASH account from the seed
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'test-acc-cash',  // no es BUDGET
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BUDGET|tipo.*cuenta/i);
  });

  test('PUT /settings/commission-config con payload válido actualiza y retorna 200', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 55,
      reinvest_share_pct: 35,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(200);
    const after = await apiGetCommissionConfig(token);
    expect(after.commission_share_pct).toBe('55');
    expect(after.reinvest_share_pct).toBe('35');
    // Restaurar defaults para no afectar otros tests
    await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
  });

  test('venta 100% cash con vendedores explícitos: crea CxP COMMISSION + PROFIT_SHARE y 2 Transfers', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CSH${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    // Contrato nuevo: sin `commission_default_team` configurado y sin `participants`
    // explícitos, resolveSellers devuelve [] (venta sin comisión) — el fallback
    // legacy owner-self 30/70 ya no existe para vendedores. Pasamos un equipo
    // explícito que suma 100 exacto (resolveSellers lo exige; el dueño no comisiona).
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });

    // Profit = 30M - 20M = 10M (sin gastos directos)
    // Cascada: comisión = 10% del gross (vendedores) → reservas 30%/10% del neto → ganancia al resto
    expect(res.summary.grossProfit).toBe(10_000_000);
    expect(res.summary.commissionPool).toBe(1_000_000);       // 10% de 10M
    expect(res.summary.reinvestAmount).toBe(2_700_000);       // 30% de (10M − 1M)
    expect(res.summary.taxAmount).toBe(900_000);              // 10% de (10M − 1M)
    expect(res.summary.profitToDistribute).toBe(5_400_000);   // resto tras comisión + reservas
    expect(res.summary.cashRatioApplied).toBe(1);             // 100% cash

    // 2 CxPs COMMISSION a nombre de los vendedores explícitos (el dueño no comisiona)
    expect(res.summary.sellers).toHaveLength(2);
    const captador = res.summary.sellers!.find(p => p.role === 'CAPTADOR');
    const cerrador = res.summary.sellers!.find(p => p.role === 'CERRADOR');
    expect(captador?.thirdPartyId).toBe(TEST_SEED_IDS.employee);
    expect(cerrador?.thirdPartyId).toBe(TEST_SEED_IDS.partner);
    expect(captador?.amount).toBe(300_000);   // 1M × 30%
    expect(cerrador?.amount).toBe(700_000);   // 1M × 70%

    // Sin investor_team configurado → fallback owner-self 100% de la ganancia
    expect(res.summary.investors).toHaveLength(1);
    expect(res.summary.investors![0].thirdPartyId).toBe('owner-self');
    expect(res.summary.investors![0].amount).toBe(5_400_000);

    // 2 Transfers: reinvest 2.7M y tax 0.9M
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.toAccountId === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.toAccountId === 'budget-tax');
    expect(reinvest?.amount).toBe(2_700_000);
    expect(tax?.amount).toBe(900_000);
  });

  test('venta 100% cruce: crea CxP COMMISSION pero 0 transfers', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CRU${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'TRADE_IN',
      buyerId: TEST_SEED_IDS.buyer,
      tradeIn: { plate: `RCV${Date.now().toString().slice(-6)}`, value: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });

    expect(res.summary.grossProfit).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBe(0);
    // 2 CxPs (10% de 10M repartido 30/70 entre los vendedores)
    expect(res.summary.sellers).toHaveLength(2);
    const totalCommitted = res.summary.sellers!.reduce((s, p) => s + p.amount, 0);
    expect(totalCommitted).toBe(1_000_000);
    expect(res.summary.transfers).toHaveLength(0);                // sin caja, sin transfer
  });

  test('venta mixed (cash + cruce): transfers proporcionales al cash', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `MIX${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    // Total: 30M (15M cash + 15M cruce) → cashRatio = 0.5. Sin vendedores (no es
    // el foco del test): commissionPool = 0, así que afterCommission = grossProfit.
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayments: [{ accountId: TEST_SEED_IDS.accountCash, amount: 15_000_000, method: 'CASH' }],
      tradeIn: { plate: `RCM${Date.now().toString().slice(-6)}`, value: 15_000_000 },
    });

    expect(res.summary.grossProfit).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBeCloseTo(0.5, 5);
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.toAccountId === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.toAccountId === 'budget-tax');
    expect(reinvest?.amount).toBeCloseTo(1_500_000, 0);  // 30% de 10M × 0.5
    expect(tax?.amount).toBeCloseTo(500_000, 0);          // 10% de 10M × 0.5
  });

  test('venta con pérdida: cero CxP, cero transfers, sin sellers/investors', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `LOSS${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 30_000_000,
      purchasePrice: 30_000_000,
      listedPrice: 25_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 25_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
    });

    expect(res.summary.grossProfit).toBeUndefined();
    expect(res.summary.sellers).toBeUndefined();
    expect(res.summary.investors).toBeUndefined();
    expect(res.summary.transfers).toBeUndefined();
  });

  test('venta con participants[] custom (vendedores): deben sumar 100 exacto, el dueño no comisiona', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CST${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    // Contrato nuevo (resolveSellers): sin fila de "resto al dueño" para comisión —
    // los vendedores deben sumar 100 exacto y owner-self no puede ir en la lista.
    // pool = (30M − 20M) × 10% = 1M · captador 30% → 300k · otro 70% → 700k
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'OTHER',    sharePct: 70 },
      ],
    });
    expect(res.summary.sellers).toHaveLength(2);
    const captador = res.summary.sellers!.find(p => p.thirdPartyId === TEST_SEED_IDS.employee);
    const socio    = res.summary.sellers!.find(p => p.thirdPartyId === TEST_SEED_IDS.partner);
    expect(res.summary.sellers!.some(p => p.thirdPartyId === 'owner-self')).toBe(false);
    expect(captador?.amount).toBe(300_000); // 1M × 0.30
    expect(socio?.amount).toBe(700_000);    // 1M × 0.70

    // El dueño sigue recibiendo su parte, pero ahora como INVERSIONISTA (fallback
    // owner-self 100% de la ganancia, ya que no hay investor_team configurado).
    expect(res.summary.investors).toHaveLength(1);
    expect(res.summary.investors![0].thirdPartyId).toBe('owner-self');
    expect(res.summary.investors![0].amount).toBe(5_400_000); // profitToDistribute completo
  });

  test('participants[] inválidos devuelven 400: suma >100 y owner-self en filas', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `BAD${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    // Caso 1: suma > 100 → 400
    const res1 = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 60 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'OTHER',    sharePct: 50 }, // suma 110
      ],
    });
    expect(res1.status).toBe(400);
    expect(res1.body?.error).toMatch(/suman|máximo 100/i);

    // Caso 2: owner-self en filas → 400 (el dueño no comisiona: su parte se
    // reparte del lado de los inversionistas, no del de los vendedores)
    const res2 = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: 70 },
      ],
    });
    expect(res2.status).toBe(400);
    expect(res2.body?.error).toMatch(/dueño/i);
  });

  test('venta con socio 50%: la cascada usa la ganancia bruta completa (participation ya no reduce la base)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `PRT${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
      partnerId: TEST_SEED_IDS.partner,
      participation: 0.5,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
    });
    // Gross profit global = 10M. A diferencia del modelo viejo (commissionBase =
    // gross × participation = 5M), calculateSaleDistribution NO lee
    // vehicle.participation: la cascada corre siempre sobre el gross completo.
    expect(res.summary.grossProfit).toBe(10_000_000);
    expect(res.summary.commissionPool).toBe(1_000_000); // 10% de 10M (no de 5M)
  });

  test('cancelSale bloqueado si hay Payables COMMISSION (incluso sin transacciones de caja)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CNX${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'TRADE_IN',
      buyerId: TEST_SEED_IDS.buyer,
      tradeIn: { plate: `RXC${Date.now().toString().slice(-6)}`, value: 30_000_000 },
      participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
    });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/cancel-sale`, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comisi[oó]n/i);
  });

  test('pagar CxP COMMISSION genera Transaction con categoría COMMISSION (no VEHICLE_PURCHASE)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `PYC${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const sale = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });
    // Paga la CxP del CERRADOR (700k = 70% de 1M pool: 10% de la ganancia de 10M)
    const cerradorPayable = sale.summary.sellers!.find(p => p.role === 'CERRADOR');
    expect(cerradorPayable).toBeDefined();

    const pay = await apiRequestRaw('POST', `/payables/${cerradorPayable!.payableId}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: cerradorPayable!.amount,
      description: 'Pago comisión cerrador',
    });
    expect(pay.status).toBe(201);

    // La transacción generada por el pago debe estar categorizada como COMMISSION,
    // no como VEHICLE_PURCHASE (que era el bug original al pagar CxP type=COMMISSION).
    const list = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    expect(list.status).toBe(200);
    const txs = (list.body as { transactions?: Array<{ category: string; amount: string }> }).transactions || [];
    const commissionTx = txs.find(t => Number(t.amount) === cerradorPayable!.amount && t.category === 'COMMISSION');
    expect(commissionTx).toBeDefined();
  });

  test('venta cash genera TRANSFER_OUT en cuenta origen y TRANSFER_IN en cuentas BUDGET', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // Vender un vehículo cash dispara: 1 INCOME en origen + 2 TRANSFER_OUT en origen
    // + 2 TRANSFER_IN en cuentas BUDGET. Esas TRANSFER_IN/OUT son las que
    // calculateBalance suma al saldo (sin ellas, las cuentas BUDGET quedan en 0).
    const v = await apiCreateVehicle(token, {
      plate: `MOV${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    });

    // En la cuenta origen: 1 INCOME (la venta) + 2 TRANSFER_OUT (reinvest + tax)
    const fromRes = await apiRequestRaw('GET', `/treasury/transactions?accountId=${TEST_SEED_IDS.accountCash}&vehicleId=${v.id}`, token);
    expect(fromRes.status).toBe(200);
    const fromTxs = (fromRes.body as { transactions?: Array<{ type: string; amount: string }> }).transactions || [];
    const transferOuts = fromTxs.filter(t => t.type === 'TRANSFER_OUT');
    expect(transferOuts.length).toBe(2);

    // En la cuenta de reinversión: 1 TRANSFER_IN (3M = 30% de 10M de ganancia)
    const reinvRes = await apiRequestRaw('GET', `/treasury/transactions?accountId=budget-reinvest`, token);
    expect(reinvRes.status).toBe(200);
    const reinvTxs = (reinvRes.body as { transactions?: Array<{ type: string; amount: string }> }).transactions || [];
    const reinvIn = reinvTxs.find(t => t.type === 'TRANSFER_IN' && Number(t.amount) === 3_000_000);
    expect(reinvIn).toBeDefined();

    // Y el saldo calculado de la cuenta BUDGET sube
    const accRes = await apiRequestRaw('GET', `/treasury/accounts/budget-reinvest`, token);
    const acc = accRes.body as { currentBalance?: string | number };
    expect(Number(acc.currentBalance)).toBeGreaterThanOrEqual(3_000_000);
  });

  test('GET /payables/summary incluye CxPs COMMISSION en el total payables', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `SUM${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });

    const res = await apiRequestRaw('GET', '/payables/summary', token);
    expect(res.status).toBe(200);
    const body = res.body as { payables?: { total: number; count: number } };
    expect(body.payables).toBeDefined();
    // El total Por Pagar incluye las CxP COMMISSION (10% de 10M = 1M de esta venta)
    expect(body.payables!.total).toBeGreaterThanOrEqual(1_000_000);
    expect(body.payables!.count).toBeGreaterThanOrEqual(2); // al menos 2 nuevas (cap+cer)
  });

  test('PayablesPage muestra 1 card por venta con desglose Captador/Cerrador y % pasados', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // Venta cash con ganancia 10M → pool comisión = 10% de 10M = 1M → captador 300k (30%) + cerrador 700k (70%)
    const plate = `PYD${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });

    await page.goto('/treasury/payables');

    // Header card de totales sigue mostrando los subtotales por rol
    await expect(page.getByTestId('commissions-captador')).toContainText(/300\.000|300,000/);
    await expect(page.getByTestId('commissions-cerrador')).toContainText(/700\.000|700,000/);

    // En el listado debe aparecer UNA card agrupada por venta con desglose interno
    const group = page.getByTestId(`commission-group-${plate}`);
    await expect(group).toBeVisible({ timeout: 10_000 });

    const captadorRow = page.getByTestId(`commission-role-captador-${plate}`);
    const cerradorRow = page.getByTestId(`commission-role-cerrador-${plate}`);
    await expect(captadorRow).toBeVisible();
    await expect(cerradorRow).toBeVisible();

    // Cada row muestra el % junto al monto (tomado del SaleParticipant, 30% y 70%)
    await expect(captadorRow).toContainText(/Captador.*30%/);
    await expect(captadorRow).toContainText(/300\.000|300,000/);
    await expect(cerradorRow).toContainText(/Cerrador.*70%/);
    await expect(cerradorRow).toContainText(/700\.000|700,000/);

    // Cada rol tiene su propio botón Pagar
    await expect(captadorRow.getByText(/Pagar/)).toBeVisible();
    await expect(cerradorRow.getByText(/Pagar/)).toBeVisible();
  });

  test('SettingsPage muestra y guarda comisiones (ADMIN)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    // Settings ahora es por pestañas: abrir la de Comisiones.
    await page.getByTestId('settings-tab-comisiones').click();
    await expect(page.getByTestId('settings-commissions-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-commission-pct')).toHaveValue('60');
    await page.getByTestId('settings-commission-pct').fill('55');
    await page.getByTestId('settings-reinvest-pct').fill('35');
    await page.getByTestId('settings-save-commissions').click();
    // Scoped a la card de comisiones: la card de inversionistas (Task 9, feature
    // ganancia-inversionistas) agregó su propio "Guardado." en la misma pestaña,
    // por lo que un getByText('Guardado.') global ahora es ambiguo (2 elementos).
    await expect(page.getByTestId('settings-commissions-card').getByText('Guardado.')).toBeVisible({ timeout: 5_000 });

    // Restaurar defaults
    await page.getByTestId('settings-commission-pct').fill('60');
    await page.getByTestId('settings-reinvest-pct').fill('30');
    await page.getByTestId('settings-save-commissions').click();
  });
});
