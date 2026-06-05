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

  test('venta 100% cash con default participant: crea CxP COMMISSION y 2 Transfers', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CSH${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    });

    // Profit = 30M - 20M = 10M (sin gastos directos, sin socio)
    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.commissionPool).toBe(6_000_000);   // 60%
    expect(res.summary.reinvestPool).toBe(3_000_000);     // 30%
    expect(res.summary.taxPool).toBe(1_000_000);          // 10%
    expect(res.summary.cashRatioApplied).toBe(1);         // 100% cash

    // Default: 1 participant (owner-self) con 100% del pool
    expect(res.summary.participants).toHaveLength(1);
    expect(res.summary.participants![0].thirdPartyId).toBe('owner-self');
    expect(res.summary.participants![0].role).toBe('CERRADOR');
    expect(res.summary.participants![0].amount).toBe(6_000_000);

    // 2 Transfers: reinvest 3M y tax 1M
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.toAccountId === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.toAccountId === 'budget-tax');
    expect(reinvest?.amount).toBe(3_000_000);
    expect(tax?.amount).toBe(1_000_000);
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
    });

    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBe(0);
    expect(res.summary.participants).toHaveLength(1);
    expect(res.summary.participants![0].amount).toBe(6_000_000); // CxP igual se causa
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
    // Total: 30M (15M cash + 15M cruce) → cashRatio = 0.5
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayments: [{ accountId: TEST_SEED_IDS.accountCash, amount: 15_000_000, method: 'CASH' }],
      tradeIn: { plate: `RCM${Date.now().toString().slice(-6)}`, value: 15_000_000 },
    });

    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBeCloseTo(0.5, 5);
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.toAccountId === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.toAccountId === 'budget-tax');
    expect(reinvest?.amount).toBeCloseTo(1_500_000, 0);  // 3M × 0.5
    expect(tax?.amount).toBeCloseTo(500_000, 0);          // 1M × 0.5
  });

  test('venta con pérdida: cero CxP, cero transfers, sin participants', async ({ page }) => {
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

    expect(res.summary.commissionBase).toBeUndefined();
    expect(res.summary.participants).toBeUndefined();
    expect(res.summary.transfers).toBeUndefined();
  });

  test('venta con participants[] custom: respeta split y valida suma 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CST${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: 'owner-self',           role: 'CERRADOR', sharePct: 70 },
      ],
    });
    expect(res.summary.participants).toHaveLength(2);
    const captador = res.summary.participants!.find(p => p.role === 'CAPTADOR');
    const cerrador = res.summary.participants!.find(p => p.role === 'CERRADOR');
    expect(captador?.amount).toBeCloseTo(1_800_000, 0); // 6M × 0.30
    expect(cerrador?.amount).toBeCloseTo(4_200_000, 0); // 6M × 0.70
  });

  test('participants[] con suma ≠ 100 devuelve 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `BAD${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: 'owner-self',           role: 'CERRADOR', sharePct: 50 }, // suma 80
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/sumar 100|sharePct/i);
  });

  test('venta con socio 50%: base de comisión es mi parte (gross × 0.5)', async ({ page }) => {
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
    });
    // Gross profit global = 10M, mi parte = 10M × 0.5 = 5M
    expect(res.summary.commissionBase).toBe(5_000_000);
    expect(res.summary.commissionPool).toBe(3_000_000); // 60% de 5M
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
    });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/cancel-sale`, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comisi[oó]n/i);
  });

  test('SettingsPage muestra y guarda comisiones (ADMIN)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-commissions-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-commission-pct')).toHaveValue('60');
    await page.getByTestId('settings-commission-pct').fill('55');
    await page.getByTestId('settings-reinvest-pct').fill('35');
    await page.getByTestId('settings-save-commissions').click();
    await expect(page.getByText('Guardado.')).toBeVisible({ timeout: 5_000 });

    // Restaurar defaults
    await page.getByTestId('settings-commission-pct').fill('60');
    await page.getByTestId('settings-reinvest-pct').fill('30');
    await page.getByTestId('settings-save-commissions').click();
  });
});
