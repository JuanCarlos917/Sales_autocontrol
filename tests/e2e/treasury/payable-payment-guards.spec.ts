import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiCreateAccount, apiRequestRaw } from '../../helpers/api';

// Hallazgo 🟠 #2 de la auditoría: payableService.addPayment creaba el egreso
// sin verificar saldo ni que la cuenta estuviera activa → caja negativa real
// desde un flujo normal (pagar CxP/comisión).

async function createPayable(token: string, totalAmount: number): Promise<string> {
  const res = await apiRequestRaw('POST', '/payables', token, {
    type: 'PAYABLE',
    totalAmount,
    description: `CxP guard test ${Date.now()}`,
  });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

test.describe('CxP — guardas de pago (saldo y cuenta activa)', () => {
  test('pagar una CxP con monto mayor al saldo de la cuenta se rechaza', async () => {
    const token = await apiPinLogin();
    // Cuenta con saldo pequeño y conocido
    const account = await apiCreateAccount(token, {
      name: `Caja chica ${Date.now()}`,
      type: 'CASH',
      initialBalance: 100_000,
    });
    const payableId = await createPayable(token, 5_000_000);

    const res = await apiRequestRaw('POST', `/payables/${payableId}/payments`, token, {
      accountId: account.id,
      amount: 500_000, // > saldo (100k)
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/saldo/i);
  });

  test('pagar desde una cuenta desactivada se rechaza', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Cuenta inactiva ${Date.now()}`,
      type: 'CASH',
      initialBalance: 1_000_000,
    });
    // Desactivar via update (isActive editable por PUT)
    const upd = await apiRequestRaw('PUT', `/treasury/accounts/${account.id}`, token, { isActive: false });
    expect(upd.status).toBe(200);

    const payableId = await createPayable(token, 500_000);
    const res = await apiRequestRaw('POST', `/payables/${payableId}/payments`, token, {
      accountId: account.id,
      amount: 200_000,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/desactivada|inactiva/i);
  });
});
