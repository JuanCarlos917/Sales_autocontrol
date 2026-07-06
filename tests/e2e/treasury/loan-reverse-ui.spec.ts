import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateLoan, apiAddLoanPayment, apiGetLoan } from '../../helpers/api';
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

test.describe('Préstamos — reverso desde la UI', () => {
  test('admin reversa un pago y aparece el badge Reversado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_000_000,
      interestRate: 0,
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
      ],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 500_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;

    await page.goto(`/treasury/loans/${loan.id}`);
    await expect(page.getByTestId('loan-detail-page')).toBeVisible();

    await page.getByTestId(`loan-detail-pay-${paymentId}-reverse-btn`).click();
    await expect(page.getByTestId(`loan-detail-pay-${paymentId}-reverse-modal`)).toBeVisible();

    const confirm = page.getByTestId(`loan-detail-pay-${paymentId}-reverse-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`loan-detail-pay-${paymentId}-reverse-reason`).fill('pago duplicado, corregir');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByTestId(`loan-detail-row-${paymentId}-reversed`)).toBeVisible({ timeout: 10_000 });
  });

  test('admin anula el préstamo completo y queda CANCELADO', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 300_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 300_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });

    await page.goto(`/treasury/loans/${loan.id}`);
    await page.getByTestId('loan-detail-reverse-btn').click();
    await expect(page.getByTestId('loan-detail-reverse-modal')).toBeVisible();
    await page.getByTestId('loan-detail-reverse-reason').fill('préstamo cargado por error');
    await page.getByTestId('loan-detail-reverse-confirm').click();

    // Tras anular, el botón desaparece (status CANCELLED) y el texto de estado lo refleja.
    await expect(page.getByTestId('loan-detail-reverse-btn')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('loan-detail-page')).toContainText(/Cancelad/i);
  });
});
