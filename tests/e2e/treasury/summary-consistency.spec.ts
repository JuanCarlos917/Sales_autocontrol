import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiCreateAccount, apiCreateTreasuryIncome, apiRequestRaw } from '../../helpers/api';

// Hallazgos 🟡 #10/#14 de la auditoría: el summary inflaba ingresos/egresos con
// transferencias internas, la fecha de contabilización era editable por PUT
// (contra la política de inmutabilidad), y la paginación no tenía tope.

test.describe('Tesorería — consistencia de summary, inmutabilidad de fecha y paginación', () => {
  test('las transferencias no inflan los totales del summary', async () => {
    const token = await apiPinLogin();
    const a = await apiCreateAccount(token, { name: `SumA ${Date.now()}`, type: 'CASH', initialBalance: 0 });
    const b = await apiCreateAccount(token, { name: `SumB ${Date.now()}`, type: 'BANK', initialBalance: 0 });

    await apiCreateTreasuryIncome(token, { accountId: a.id, amount: 1_000_000, description: 'ingreso real' });
    const tr = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: a.id, toAccountId: b.id, amount: 200_000,
    });
    expect(tr.status).toBe(201);

    const res = await apiRequestRaw('GET', `/treasury/transactions/summary?accountId=${a.id}`, token, undefined);
    expect(res.status).toBe(200);
    const s = res.body as { totalIncome: number; totalExpense: number };
    // Hoy: totalExpense incluye el TRANSFER_OUT (200k). Esperado: solo flujo real.
    expect(s.totalIncome).toBe(1_000_000);
    expect(s.totalExpense).toBe(0);
  });

  test('la fecha de contabilización no es editable por PUT', async () => {
    const token = await apiPinLogin();
    const a = await apiCreateAccount(token, { name: `Fecha ${Date.now()}`, type: 'CASH', initialBalance: 0 });
    const txn = await apiCreateTreasuryIncome(token, { accountId: a.id, amount: 50_000 });

    const upd = await apiRequestRaw('PUT', `/treasury/transactions/${txn.id}`, token, {
      description: 'editada',
      date: '2020-01-01',
    });
    expect(upd.status).toBe(200);
    const after = (upd.body as { date: string; description: string });
    expect(after.description).toBe('editada');
    expect(after.date.startsWith('2020')).toBe(false); // la fecha NO cambió
  });

  test('la paginación de movimientos tiene tope y tolera basura', async () => {
    const token = await apiPinLogin();
    const huge = await apiRequestRaw('GET', '/treasury/transactions?limit=999999', token, undefined);
    expect(huge.status).toBe(200);
    expect((huge.body as { limit: number }).limit).toBeLessThanOrEqual(500);

    const junk = await apiRequestRaw('GET', '/treasury/transactions?limit=abc&offset=xyz', token, undefined);
    expect(junk.status).toBe(200); // hoy: parseInt NaN → 500
  });
});
