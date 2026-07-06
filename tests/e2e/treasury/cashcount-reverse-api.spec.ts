import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateCashCount, apiReverseCashCountRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — anular arqueo (API)', () => {
  test('anular un arqueo lo marca voided y no vuelve a anularse', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cc = await apiCreateCashCount(token, {
      accountId: TEST_SEED_IDS.accountCash,
      countedBalance: 1_234_567,
      notes: 'arqueo de prueba',
    });
    expect(cc.voidedAt).toBeNull();

    const res = await apiReverseCashCountRaw(token, cc.id, 'conteo erróneo, se recontará');
    expect(res.status).toBe(200);
    expect(res.body.voidedAt).not.toBeNull();

    // Doble anulación → 409
    const second = await apiReverseCashCountRaw(token, cc.id, 'conteo erróneo, se recontará');
    expect(second.status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cc = await apiCreateCashCount(token, { accountId: TEST_SEED_IDS.accountCash, countedBalance: 500_000 });
    expect((await apiReverseCashCountRaw(token, cc.id, 'corto')).status).toBe(400);
  });

  test('arqueo inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseCashCountRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
