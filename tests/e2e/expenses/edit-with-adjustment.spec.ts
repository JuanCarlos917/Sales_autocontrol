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

    // Visibilidad total: el listing muestra el VEHICLE_EXPENSE original
    // (500k) + el EXPENSE_ADJUSTMENT con el delta (-100k, type INCOME). El
    // ajuste enlaza al original via reversesTransactionId.
    expect(expenseTxs.length).toBe(2);
    const original = expenseTxs.find((t) => t.category === 'VEHICLE_EXPENSE')!;
    const adjustment = expenseTxs.find((t) => t.category === 'EXPENSE_ADJUSTMENT')!;
    expect(original.type).toBe('EXPENSE');
    expect(parseFloat(original.amount as string)).toBe(500_000);
    expect(adjustment.type).toBe('INCOME'); // bajó el monto → compensación INCOME
    expect(parseFloat(adjustment.amount as string)).toBe(100_000);
    expect(adjustment.reversesTransactionId).toBe(original.id);

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
