import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetCommissionConfig,
  apiUpdateCommissionConfig,
  apiCreateVehicle,
  apiRegisterSale,
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
});
