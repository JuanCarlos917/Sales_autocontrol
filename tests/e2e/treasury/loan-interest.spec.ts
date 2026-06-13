import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiGetAccount, apiCreateLoan, apiGetLoan, apiAddLoanPayment } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — préstamos con interés', () => {
  test('crea préstamo 10M @ 10%, total 11M, pagos reparten capital e interés y cierra exacto', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 10_000_000,
      interestRate: 10,
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 5_500_000 },
        { sequence: 2, dueDate: today, plannedAmount: 5_500_000 },
      ],
    });

    expect(parseFloat(String(loan.interestAmount))).toBe(1_000_000);

    const bankBefore = parseFloat(
      String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance),
    );

    // Primer pago 5.5M: interés = 5.5M * 1M/11M = 500k; capital = 5M.
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 5_500_000,
    });
    const afterFirst = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterFirst.paidAmount))).toBe(5_500_000);
    expect(parseFloat(String(afterFirst.interestReceived))).toBe(500_000);
    expect(afterFirst.status).toBe('PARTIAL');

    // Segundo pago salda el préstamo: interés cierra exacto en 1M.
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 5_500_000,
    });
    const afterSecond = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterSecond.paidAmount))).toBe(11_000_000);
    expect(parseFloat(String(afterSecond.interestReceived))).toBe(1_000_000);
    expect(afterSecond.status).toBe('PAID');

    const bankAfter = parseFloat(
      String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance),
    );
    expect(bankAfter - bankBefore).toBe(11_000_000);
  });
});
