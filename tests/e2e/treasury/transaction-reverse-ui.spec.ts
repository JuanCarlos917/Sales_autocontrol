import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateTreasuryIncome } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — reverso de movimientos (UI admin)', () => {
  test('admin reversa un ingreso y aparece el badge Reversado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 150_000,
      description: 'ingreso a reversar desde UI',
    });

    await page.goto('/treasury/transactions');
    const reverseBtn = page.locator(`[data-testid="tx-reverse-${income.id}"]`);
    await expect(reverseBtn).toBeVisible({ timeout: 10_000 });
    await reverseBtn.click();

    const modal = page.locator('[data-testid="reverse-modal"]');
    await expect(modal).toBeVisible();

    const confirm = page.locator('[data-testid="reverse-confirm"]');
    await expect(confirm).toBeDisabled();

    await page.locator('[data-testid="reverse-reason"]').fill('corrección: monto digitado por error');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.locator(`[data-testid="reversed-badge-${income.id}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="origin-badge-MANUAL_REVERSAL"]').first()).toBeVisible();
  });
});
