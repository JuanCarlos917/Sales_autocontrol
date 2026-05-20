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

  test('la fecha del movimiento es la de registro: ignora la fecha enviada por el cliente', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = TEST_SEED_IDS.accountBank;

    // Aunque se envíen fechas arbitrarias, el orden es por registro y la fecha guardada es hoy.
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 5_000_000, date: '2030-12-31', description: 'futuro' });
    await apiCreateTreasuryIncome(token, { accountId: acc, amount: 6_000_000, date: '2020-01-01', description: 'pasado' });

    const txs = await apiListTransactions(token, { accountId: acc });
    const top2 = txs.slice(0, 2);

    // Orden por registro (el último arriba), sin importar la fecha enviada.
    expect(top2.map((t) => parseFloat(t.amount as string))).toEqual([6_000_000, 5_000_000]);
    // La fecha guardada es la de registro (año actual), no la '2020'/'2030' enviada.
    const currentYear = new Date().getFullYear();
    expect(new Date(top2[0].date).getFullYear()).toBe(currentYear);
    expect(new Date(top2[1].date).getFullYear()).toBe(currentYear);
  });
});
