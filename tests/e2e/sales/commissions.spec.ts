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
});
