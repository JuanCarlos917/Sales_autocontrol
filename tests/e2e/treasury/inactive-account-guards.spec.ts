import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiCreateAccount, apiRequestRaw } from '../../helpers/api';

// Hallazgo 🟠 #5 de la auditoría: una cuenta desactivada seguía aceptando
// movimientos manuales y transferencias (la desactivación era cosmética).
// loans/debts ya verificaban isActive; payables lo ganó en el lote 2a.

async function createInactiveAccount(token: string, initialBalance: number): Promise<string> {
  const account = await apiCreateAccount(token, {
    name: `Inactiva ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'CASH',
    initialBalance,
  });
  const upd = await apiRequestRaw('PUT', `/treasury/accounts/${account.id}`, token, { isActive: false });
  expect(upd.status).toBe(200);
  return account.id;
}

test.describe('Tesorería — cuentas desactivadas no admiten movimientos', () => {
  test('ingreso manual a cuenta desactivada se rechaza', async () => {
    const token = await apiPinLogin();
    const accountId = await createInactiveAccount(token, 0);
    const res = await apiRequestRaw('POST', '/treasury/transactions/income', token, {
      accountId,
      category: 'OTHER_INCOME',
      amount: 100_000,
      description: 'ingreso a inactiva',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/desactivada|inactiva/i);
  });

  test('egreso manual desde cuenta desactivada se rechaza', async () => {
    const token = await apiPinLogin();
    const accountId = await createInactiveAccount(token, 1_000_000);
    const res = await apiRequestRaw('POST', '/treasury/transactions/expense', token, {
      accountId,
      category: 'OTHER_EXPENSE',
      amount: 100_000,
      description: 'egreso desde inactiva',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/desactivada|inactiva/i);
  });

  test('transferencia desde o hacia una cuenta desactivada se rechaza', async () => {
    const token = await apiPinLogin();
    const active = await apiCreateAccount(token, {
      name: `Activa ${Date.now()}`,
      type: 'CASH',
      initialBalance: 1_000_000,
    });
    const inactiveId = await createInactiveAccount(token, 0);

    // hacia inactiva
    const toInactive = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: active.id,
      toAccountId: inactiveId,
      amount: 100_000,
    });
    expect(toInactive.status).toBe(400);

    // desde inactiva (tiene saldo 0, pero el error debe ser por inactiva, no por saldo)
    const inactiveWithFunds = await createInactiveAccount(token, 500_000);
    const fromInactive = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: inactiveWithFunds,
      toAccountId: active.id,
      amount: 100_000,
    });
    expect(fromInactive.status).toBe(400);
    expect((fromInactive.body as { error?: string }).error).toMatch(/desactivada|inactiva/i);
  });
});
