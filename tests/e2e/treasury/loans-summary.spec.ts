import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateLoan,
  apiListLoans,
  apiAddLoanPayment,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function computeExpectedTotal(
  loans: Array<{ status: string; principalAmount: string | number; paidAmount: string | number }>,
): number {
  return loans
    .filter((l) => l.status !== 'PAID' && l.status !== 'CANCELLED')
    .reduce(
      (s, l) =>
        s + (parseFloat(l.principalAmount as string) - parseFloat(l.paidAmount as string)),
      0,
    );
}

test.describe('Tesorería — resumen de préstamos en landing', () => {
  test('card de totales refleja el saldo pendiente agregado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loanA = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 2_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 2_000_000 }],
    });

    await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.buyer,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 3_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 3_000_000 }],
    });

    await apiAddLoanPayment(token, loanA.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 500_000,
    });

    const allLoans = await apiListLoans(token);
    const expectedTotal = computeExpectedTotal(allLoans);
    expect(expectedTotal).toBeGreaterThanOrEqual(4_500_000);

    await page.goto('/treasury');

    const totalEl = page.getByTestId('loans-summary-total');
    await expect(totalEl).toBeVisible();
    await expect(totalEl).toHaveText(formatCOP(expectedTotal));
  });

  test('click en deudor navega a LoansPage filtrado por borrower', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loanEmployee = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_500_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 1_500_000 }],
    });

    const loanBuyer = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.buyer,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 2_500_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 2_500_000 }],
    });

    await page.goto('/treasury');

    const employeeRow = page.getByTestId(`loans-summary-borrower-${TEST_SEED_IDS.employee}`);
    await expect(employeeRow).toBeVisible();
    await employeeRow.click();

    await page.waitForURL(`**/treasury/loans?borrower=${TEST_SEED_IDS.employee}`);

    const badge = page.getByTestId('loans-borrower-filter-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Empleado Test');

    await expect(page.getByTestId(`loan-card-${loanEmployee.id}`)).toBeVisible();
    await expect(page.getByTestId(`loan-card-${loanBuyer.id}`)).toHaveCount(0);

    await page.getByTestId('loans-borrower-filter-clear').click();
    await expect(page).toHaveURL(/\/treasury\/loans$/);
    await expect(page.getByTestId(`loan-card-${loanBuyer.id}`)).toBeVisible();
  });
});
