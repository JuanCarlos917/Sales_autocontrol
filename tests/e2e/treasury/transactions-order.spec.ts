import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateTreasuryIncome, apiCreateTreasuryExpense, apiListTransactions } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — orden de /treasury/transactions por hora de registro', () => {
  test('dentro de la misma fecha, ordena por registro (más reciente primero) intercalando ingresos y egresos', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = TEST_SEED_IDS.accountBank; // sin transacción semilla
    const SAME_DATE = '2026-05-15';

    // Se registran en secuencia con la MISMA fecha: ingreso, egreso, ingreso.
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 10_000_000, date: SAME_DATE, description: 'A ingreso' });
    await apiCreateTreasuryExpense(token, { accountId: acc, amount: 4_000_000, date: SAME_DATE, description: 'B egreso' });
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 6_000_000, date: SAME_DATE, description: 'C ingreso' });

    const txs = await apiListTransactions(token, { accountId: acc });
    const top3 = txs.slice(0, 3);

    // Orden de registro inverso: C, B, A — intercalado, no agrupado por tipo.
    expect(top3.map((t) => t.description)).toEqual(['C ingreso', 'B egreso', 'A ingreso']);
    expect(top3.map((t) => t.type)).toEqual(['INCOME', 'EXPENSE', 'INCOME']);
  });

  test('los de hoy quedan arriba aunque uno con fecha anterior se haya registrado después', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = TEST_SEED_IDS.accountBank;

    // Primero un movimiento con fecha de HOY, luego uno con fecha de AYER (registrado después).
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 5_000_000, date: '2026-05-20', description: 'hoy' });
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 6_000_000, date: '2026-05-19', description: 'ayer' });

    const txs = await apiListTransactions(token, { accountId: acc });
    const top2 = txs.slice(0, 2);

    // La fecha manda: el de hoy (5M) va arriba, aunque el de ayer (6M) se registró después.
    expect(top2.map((t) => parseFloat(t.amount as string))).toEqual([5_000_000, 6_000_000]);
  });
});
