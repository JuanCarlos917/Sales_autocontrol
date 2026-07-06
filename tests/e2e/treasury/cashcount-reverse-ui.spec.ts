import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateCashCount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Arqueos — anulación desde la UI', () => {
  test('admin anula un arqueo y aparece el badge Anulado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cc = await apiCreateCashCount(token, {
      accountId: TEST_SEED_IDS.accountCash,
      countedBalance: 12_345_678,
      notes: 'arqueo UI reverso',
    });

    await page.goto('/treasury/cash-count');
    await expect(page.getByTestId(`cashcount-row-${cc.id}`)).toBeVisible();

    await page.getByTestId(`cashcount-${cc.id}-reverse-btn`).click();
    await expect(page.getByTestId(`cashcount-${cc.id}-reverse-modal`)).toBeVisible();

    const confirm = page.getByTestId(`cashcount-${cc.id}-reverse-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`cashcount-${cc.id}-reverse-reason`).fill('arqueo mal registrado');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByTestId(`cashcount-${cc.id}-voided`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`cashcount-${cc.id}-reverse-btn`)).toHaveCount(0);
  });
});
