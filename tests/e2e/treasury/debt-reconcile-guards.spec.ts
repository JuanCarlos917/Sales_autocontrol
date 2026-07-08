import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiCreateDebt,
  apiCreateTreasuryIncome,
  apiCreateTreasuryExpense,
  apiReverseTransactionRaw,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Guardas de reconciliación (hallazgo 🔴 de auditoría): un crédito NO puede
// "pagarse" con dinero que ya volvió a caja. Ni los compensatorios de un
// reverso (type EXPENSE, categoría *_REVERSAL) ni los egresos ya reversados
// (reversedBy no vacío) son elegibles para reconciliar.

function isoDueDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

async function apiGetReconcileCandidates(token: string): Promise<Array<{ id: string }>> {
  const res = await apiRequestRaw('GET', '/debts/reconcile-candidates', token, undefined);
  expect(res.status).toBe(200);
  return res.body as Array<{ id: string }>;
}

test.describe('Créditos — guardas de reconciliación contra reversos', () => {
  test('el compensatorio de un reverso no es candidato ni reconciliable', async () => {
    const token = await apiPinLogin();
    // Ingreso manual y su reverso: el compensatorio es un EXPENSE MANUAL_REVERSAL
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 500_000,
      description: 'ingreso manual para reverso (guard test)',
    });
    const reversed = await apiReverseTransactionRaw(token, income.id, {
      reason: 'reverso para probar guardas de reconciliación',
    });
    expect(reversed.status).toBe(201);
    const compensatingId = reversed.body!.id as string;

    // 1) No debe aparecer como candidato
    const candidates = await apiGetReconcileCandidates(token);
    expect(candidates.some((c) => c.id === compensatingId)).toBe(false);

    // 2) Reconciliarlo directo debe rechazarse
    const debt = await apiCreateDebt(token, {
      name: `Guard compensatorio ${Date.now()}`,
      installments: [{ sequence: 1, dueDate: isoDueDate(), plannedAmount: 500_000 }],
    });
    const res = await apiRequestRaw('POST', `/debts/${debt.id}/reconcile`, token, {
      transactionIds: [compensatingId],
    });
    expect(res.status).toBe(400);
  });

  test('un egreso ya reversado no es candidato ni reconciliable', async () => {
    const token = await apiPinLogin();
    // Egreso manual reversado: su plata ya volvió a caja
    const expense = await apiCreateTreasuryExpense(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 300_000,
      description: 'egreso manual reversado (guard test)',
    });
    const reversed = await apiReverseTransactionRaw(token, expense.id, {
      reason: 'reverso para probar guardas de reconciliación',
    });
    expect(reversed.status).toBe(201);

    // 1) El egreso original (ya compensado) no debe aparecer como candidato
    const candidates = await apiGetReconcileCandidates(token);
    expect(candidates.some((c) => c.id === expense.id)).toBe(false);

    // 2) Reconciliarlo directo debe rechazarse
    const debt = await apiCreateDebt(token, {
      name: `Guard reversado ${Date.now()}`,
      installments: [{ sequence: 1, dueDate: isoDueDate(), plannedAmount: 300_000 }],
    });
    const res = await apiRequestRaw('POST', `/debts/${debt.id}/reconcile`, token, {
      transactionIds: [expense.id],
    });
    expect(res.status).toBe(400);
  });
});
