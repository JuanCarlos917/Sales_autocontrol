import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiCreateAccount,
  apiGetAccount,
  apiCreateDebt,
  apiGetDebt,
  apiRequestRaw,
} from '../../helpers/api';

// Hallazgos 🟠 #3/#4 de la auditoría (TOCTOU): los checks de saldo y los
// agregados (paidAmount) se leían FUERA de la $transaction. Bajo concurrencia:
// (a) dos egresos pasan ambos el check de saldo → caja negativa;
// (b) dos pagos leen el mismo paidAmount → lost update (agregado ≠ ledger).
// Estos tests disparan N requests en paralelo y verifican las invariantes.

function isoDueDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

test.describe('Tesorería — invariantes bajo concurrencia', () => {
  test('egresos concurrentes no dejan la cuenta en negativo', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Race saldo ${Date.now()}`,
      type: 'CASH',
      initialBalance: 100_000,
    });

    // 5 egresos de 80k contra 100k de saldo: secuencialmente solo 1 cabe.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        apiRequestRaw('POST', '/treasury/transactions/expense', token, {
          accountId: account.id,
          category: 'OTHER_EXPENSE',
          amount: 80_000,
          description: `race expense ${i}`,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;

    const after = await apiGetAccount(token, account.id);
    const balance = Number(after.currentBalance);
    // Invariante: la caja NUNCA queda negativa (y lo aceptado cuadra con el saldo).
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(100_000 - ok * 80_000);
  });

  test('pagos concurrentes a un crédito no pierden actualizaciones (paidAmount == ledger)', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Race debt ${Date.now()}`,
      type: 'CASH',
      initialBalance: 10_000_000,
    });
    const debt = await apiCreateDebt(token, {
      name: `Crédito race ${Date.now()}`,
      installments: [{ sequence: 1, dueDate: isoDueDate(), plannedAmount: 500_000 }],
    });

    // 5 pagos de 200k contra total 500k: secuencialmente caben 2 (400k) y el resto rechaza.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        apiRequestRaw('POST', `/debts/${debt.id}/payments`, token, {
          accountId: account.id,
          amount: 200_000,
        }),
      ),
    );
    const okCount = results.filter((r) => r.status === 200 || r.status === 201).length;

    const after = await apiGetDebt(token, debt.id);
    const paid = Number(after.paidAmount);
    // Invariantes: el agregado refleja EXACTAMENTE los pagos aceptados y nunca
    // supera el total del crédito.
    expect(paid).toBe(okCount * 200_000);
    expect(paid).toBeLessThanOrEqual(500_000);
  });

  test('pagos concurrentes a una CxP no la sobre-pagan (solo uno de N por el total)', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Race payable ${Date.now()}`,
      type: 'CASH',
      initialBalance: 10_000_000,
    });
    const created = await apiRequestRaw('POST', '/payables', token, {
      type: 'PAYABLE',
      totalAmount: 300_000,
      description: `CxP race ${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const payableId = (created.body as { id: string }).id;

    // 3 pagos por el TOTAL en paralelo: solo uno puede entrar.
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        apiRequestRaw('POST', `/payables/${payableId}/payments`, token, {
          accountId: account.id,
          amount: 300_000,
        }),
      ),
    );
    const okCount = results.filter((r) => r.status === 201).length;
    expect(okCount).toBe(1);
  });
});
