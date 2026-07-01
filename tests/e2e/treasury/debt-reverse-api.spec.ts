import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateDebt,
  apiGetDebt,
  apiAddDebtPayment,
  apiReconcileDebt,
  apiCreateTreasuryExpense,
  apiReverseDebtPaymentRaw,
  apiReverseDebtRaw,
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

async function createDebt2x500(token: string) {
  const due = isoDueDates(2);
  return apiCreateDebt(token, {
    name: 'Crédito de prueba',
    installments: [
      { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
      { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
    ],
  });
}

test.describe('Tesorería — reverso de pagos de crédito (API)', () => {
  test('reversar un pago restaura el saldo del crédito y devuelve la plata a la cuenta', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);

    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 500_000 });
    const afterPay = await apiGetDebt(token, debt.id);
    expect(parseFloat(String(afterPay.paidAmount))).toBe(500_000);
    const paymentId = afterPay.payments[0].id;
    const cashAfterPay = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const res = await apiReverseDebtPaymentRaw(token, paymentId, 'pago duplicado, corregir');
    expect(res.status).toBe(201);

    const afterReverse = await apiGetDebt(token, debt.id);
    expect(parseFloat(String(afterReverse.paidAmount))).toBe(0);
    expect(afterReverse.status).toBe('PENDING');
    expect(afterReverse.payments[0].reversedAt).not.toBeNull();
    expect(afterReverse.installments[0].status).toBe('PENDING');

    // El pago era EXPENSE (egreso); su reverso es INCOME → la caja sube en 500k.
    const cashAfterReverse = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfterReverse).toBe(cashAfterPay + 500_000);
  });

  test('doble reverso del mismo pago → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 200_000 });
    const paymentId = (await apiGetDebt(token, debt.id)).payments[0].id;

    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(201);
    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 100_000 });
    const paymentId = (await apiGetDebt(token, debt.id)).payments[0].id;
    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corto')).status).toBe(400);
  });

  test('pago inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseDebtPaymentRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });

  test('un pago reconciliado NO se puede reversar → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);

    // Crear un egreso histórico y reconciliarlo al crédito.
    const expenseTx = await apiCreateTreasuryExpense(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 300_000,
      description: 'egreso histórico a reconciliar',
    });
    await apiReconcileDebt(token, debt.id, [expenseTx.id]);

    const reconciledPaymentId = (await apiGetDebt(token, debt.id)).payments[0].id;
    const res = await apiReverseDebtPaymentRaw(token, reconciledPaymentId, 'intento de reverso reconciliado');
    expect(res.status).toBe(400);
  });
});

test.describe('Tesorería — reverso de crédito completo (cascada, API)', () => {
  test('anular crédito con pagos compensa todos los pagos y restaura la caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    const debt = await createDebt2x500(token);

    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 400_000 });
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 100_000 });

    const res = await apiReverseDebtRaw(token, debt.id, 'crédito cargado por error');
    expect(res.status).toBe(201);

    const after = await apiGetDebt(token, debt.id);
    expect(after.status).toBe('CANCELLED');
    expect(parseFloat(String(after.paidAmount))).toBe(0);
    expect(after.payments.every((p) => p.reversedAt !== null)).toBe(true);
    expect(after.installments.every((i) => i.status === 'PENDING')).toBe(true);

    // Crear el crédito no mueve plata; reversar los 2 pagos (egresos) devuelve todo → caja vuelve al inicio.
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('doble anulación del mismo crédito → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 200_000 });
    expect((await apiReverseDebtRaw(token, debt.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseDebtRaw(token, debt.id, 'cargado por error')).status).toBe(409);
  });

  test('anular en cascada un crédito con pago reconciliado → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    const expenseTx = await apiCreateTreasuryExpense(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 200_000,
      description: 'egreso histórico a reconciliar (cascada)',
    });
    await apiReconcileDebt(token, debt.id, [expenseTx.id]);
    const res = await apiReverseDebtRaw(token, debt.id, 'intento anular con reconciliado');
    expect(res.status).toBe(400);
  });
});
