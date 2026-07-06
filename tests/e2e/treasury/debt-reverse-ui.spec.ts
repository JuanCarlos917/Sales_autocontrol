import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateDebt, apiAddDebtPayment, apiGetDebt } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function isoDueDates(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + i);
    out.push(d.toISOString());
  }
  return out;
}

test.describe('Créditos — reverso desde la UI', () => {
  test('admin reversa un pago y aparece el badge Reversado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const debt = await apiCreateDebt(token, {
      name: 'Crédito UI reverso pago',
      lender: 'Banco X',
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
      ],
    });
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 300_000 });
    const paymentId = (await apiGetDebt(token, debt.id)).payments[0].id;

    await page.goto(`/treasury/debts/${debt.id}`);
    await expect(page.getByTestId('debt-detail-page')).toBeVisible();

    await page.getByTestId(`debt-detail-pay-${paymentId}-reverse-btn`).click();
    await expect(page.getByTestId(`debt-detail-pay-${paymentId}-reverse-modal`)).toBeVisible();

    const confirm = page.getByTestId(`debt-detail-pay-${paymentId}-reverse-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`debt-detail-pay-${paymentId}-reverse-reason`).fill('pago mal aplicado, corregir');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByTestId(`debt-detail-row-${paymentId}-reversed`)).toBeVisible({ timeout: 10_000 });
  });

  test('admin anula el crédito completo y queda CANCELADO', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const debt = await apiCreateDebt(token, {
      name: 'Crédito UI anular',
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 300_000 }],
    });
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 100_000 });

    await page.goto(`/treasury/debts/${debt.id}`);
    await page.getByTestId('debt-detail-reverse-btn').click();
    await expect(page.getByTestId('debt-detail-reverse-modal')).toBeVisible();
    await page.getByTestId('debt-detail-reverse-reason').fill('crédito cargado por error');
    await page.getByTestId('debt-detail-reverse-confirm').click();

    await expect(page.getByTestId('debt-detail-reverse-btn')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('debt-detail-page')).toContainText(/Cancelad/i);
  });
});
