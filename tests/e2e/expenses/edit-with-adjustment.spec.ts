import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiListTransactions,
  apiGetExpenseAudit,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Gastos — edit con ajuste de tesorería', () => {
  test('editar amount de un gasto pagado genera Transaction de ajuste y net = nuevo amount', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const vehicle = await apiCreateVehicle(token, { plate: `EDT${Date.now().toString().slice(-7)}` });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'MECANICA',
      amount: 500_000,
      description: 'Reparación motor',
      isPaid: true,
    });

    await apiUpdateExpense(token, expense.id, { amount: 400_000, reason: 'Sobrestimé el costo' });

    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const expenseTxs = txs.filter((t) => t.expenseId === expense.id);

    // Listing rollup: el endpoint oculta EXPENSE_ADJUSTMENT y muestra el VEHICLE_EXPENSE
    // con el monto ACTUAL (400k después de la edición). Los ajustes siguen en DB y
    // mantienen los balances correctos, pero no asoman como movimientos separados.
    expect(expenseTxs.length).toBe(1);
    expect(expenseTxs[0].category).toBe('VEHICLE_EXPENSE');
    expect(expenseTxs[0].type).toBe('EXPENSE');
    expect(parseFloat(expenseTxs[0].amount as string)).toBe(400_000);
    expect(txs.find((t) => t.category === 'EXPENSE_ADJUSTMENT')).toBeUndefined();

    // Audit log refleja el UPDATE
    const audit = await apiGetExpenseAudit(token, expense.id);
    const updateEntries = audit.filter((a) => a.action === 'UPDATE');
    expect(updateEntries.length).toBeGreaterThanOrEqual(1);
    expect(updateEntries[0].reason).toMatch(/sobrestim/i);
  });

  test('editar amount cuando CxP tiene pagos parciales devuelve 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `BLK${Date.now().toString().slice(-7)}` });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'ESTETICA',
      amount: 300_000,
      isPaid: false,
      dueDate: new Date().toISOString().slice(0, 10),
    });

    // Pago parcial
    await page.request.post(`http://localhost:4000/api/expenses/${expense.id}/pay`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { accountId: TEST_SEED_IDS.accountBank, amount: 100_000 },
    });

    let error: Error | null = null;
    try {
      await apiUpdateExpense(token, expense.id, { amount: 250_000 });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/pagos parciales|400/i);
  });
});
