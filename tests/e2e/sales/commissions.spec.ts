import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetCommissionConfig,
  apiUpdateCommissionConfig,
} from '../../helpers/api';

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
});
