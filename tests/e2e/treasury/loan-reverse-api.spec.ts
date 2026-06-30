import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
  apiReverseLoanPaymentRaw,
  apiReverseLoanRaw,
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

test.describe('Tesorería — reverso de préstamo completo (cascada, API)', () => {
  test('anular préstamo con pago compensa desembolso + pago y restaura la caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

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
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 400_000 });

    const res = await apiReverseLoanRaw(token, loan.id, 'préstamo cargado por error');
    expect(res.status).toBe(201);

    const after = await apiGetLoan(token, loan.id);
    expect(after.status).toBe('CANCELLED');
    expect(parseFloat(String(after.paidAmount))).toBe(0);
    expect(after.payments.every((p) => p.reversedAt !== null)).toBe(true);
    expect(after.installments.every((i) => i.status === 'PENDING')).toBe(true);

    // Desembolso (-1M) + pago (+400k) revertidos → la caja vuelve a su saldo inicial.
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('doble anulación del mismo préstamo → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 200_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 200_000 }],
    });
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(409);
  });

  test('reversar un pago de un préstamo ya anulado → 400', async ({ page }) => {
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
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corrección tardía')).status).toBe(400);
  });

  // Interest path: principal=1_000_000, rate=10% → interestAmount=100_000, totalToRepay=1_100_000.
  // Payment of 550_000 on a PARTIAL loan uses splitLoanPayment(550_000, 100_000, 1_100_000)
  // → interestPortion = round(550_000 * 100_000 / 1_100_000) = 50_000 > 0.
  // Reversing that payment must zero out interestReceived and drop cash by the full 550_000.
  test('reversar pago con interés restaura interestReceived=0 y ajusta la caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);

    // principal 1_000_000 @ 10% → interestAmount 100_000 → totalToRepay 1_100_000.
    // Two installments of 550_000 each (sum = 1_100_000, matches totalToRepay exactly).
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_000_000,
      interestRate: 10,
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 550_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 550_000 },
      ],
    });

    // Partial payment of 550_000: since loan stays PARTIAL (paidAmount < totalToRepay),
    // splitLoanPayment is used → interestPortion = 50_000, capitalPortion = 500_000.
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountCash,
      principalAmount: 550_000,
    });

    const afterPay = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterPay.interestReceived))).toBeGreaterThan(0);
    const paymentId = afterPay.payments[0].id;
    const cashAfterPay = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const res = await apiReverseLoanPaymentRaw(token, paymentId, 'pago con interés registrado por error');
    expect(res.status).toBe(201);

    const afterReverse = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterReverse.interestReceived))).toBe(0);
    expect(parseFloat(String(afterReverse.paidAmount))).toBe(0);
    expect(afterReverse.payments[0].reversedAt).not.toBeNull();

    // The reversal compensates both LOAN_REPAYMENT (500_000) and LOAN_INTEREST_INCOME (50_000)
    // → cash drops by the full 550_000 that had come in.
    const cashAfterReverse = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfterReverse).toBe(cashAfterPay - 550_000);
  });
});
