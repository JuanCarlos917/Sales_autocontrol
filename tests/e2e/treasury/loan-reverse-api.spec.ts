import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
  apiReverseLoanPaymentRaw,
} from '../../helpers/api';
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

test.describe('Tesorería — reverso de pagos de préstamo (API)', () => {
  test('reversar un pago restaura saldo del préstamo y de la cuenta + crea compensatorio', async ({ page }) => {
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

    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountCash,
      principalAmount: 500_000,
    });

    const afterPay = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterPay.paidAmount))).toBe(500_000);
    const paymentId = afterPay.payments[0].id;
    const cashAfterPay = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const res = await apiReverseLoanPaymentRaw(token, paymentId, 'pago duplicado, corregir');
    expect(res.status).toBe(201);

    const afterReverse = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterReverse.paidAmount))).toBe(0);
    expect(afterReverse.status).toBe('PENDING');
    expect(afterReverse.payments[0].reversedAt).not.toBeNull();
    expect(afterReverse.installments[0].status).toBe('PENDING');

    // El pago era INCOME a caja; su reverso es EXPENSE → la caja baja en 500k.
    const cashAfterReverse = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfterReverse).toBe(cashAfterPay - 500_000);
  });

  test('doble reverso del mismo pago → 409', async ({ page }) => {
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
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;

    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(201);
    const second = await apiReverseLoanPaymentRaw(token, paymentId, 'corrección de monto');
    expect(second.status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 200_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 200_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;
    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corto')).status).toBe(400);
  });

  test('pago inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseLoanPaymentRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
