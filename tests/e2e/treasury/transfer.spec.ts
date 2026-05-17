import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiGetAccount } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — transferencia entre cuentas', () => {
  test('Caja → Banco: debita origen y acredita destino por igual monto', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const TRANSFER_AMOUNT = 2_000_000;

    const cashBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );
    expect(cashBefore).toBeGreaterThanOrEqual(TRANSFER_AMOUNT);

    await page.goto('/treasury/transactions');

    await page.getByTestId('transactions-transfer-button').click();

    const fromSelect = page.getByTestId('transfer-from-account');
    await expect(fromSelect).toBeVisible({ timeout: 5_000 });
    await fromSelect.selectOption(TEST_SEED_IDS.accountCash);

    await page.getByTestId('transfer-to-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('transactions-modal-amount').fill(String(TRANSFER_AMOUNT));

    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/treasury/transfers') && resp.request().method() === 'POST' && resp.status() < 400,
        { timeout: 10_000 },
      ),
      page.getByTestId('transactions-modal-submit').click(),
    ]);

    const cashAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    expect(cashBefore - cashAfter).toBe(TRANSFER_AMOUNT);
    expect(bankAfter - bankBefore).toBe(TRANSFER_AMOUNT);
  });
});
