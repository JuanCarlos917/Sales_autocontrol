import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiDeleteExpense,
  apiRestoreExpense,
  apiListExpenses,
  apiListTransactions,
  apiGetExpenseAudit,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Gastos — soft delete y undo', () => {
  test('delete con motivo válido marca deletedAt, crea reverso, audit log con reason', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `DEL${Date.now().toString().slice(-7)}` });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'PARQUEADERO',
      amount: 50_000,
      isPaid: true,
    });

    await apiDeleteExpense(token, expense.id, 'Gasto duplicado por error');

    // No aparece en listado normal
    const visible = await apiListExpenses(token);
    expect(visible.find((e) => e.id === expense.id)).toBeUndefined();

    // Listing rollup: el gasto borrado no aparece como movimiento visible.
    // El original VEHICLE_EXPENSE y el EXPENSE_REVERSAL existen en DB (para audit
    // trail y para que el balance de cuenta esté correcto), pero el endpoint los
    // oculta porque suman 0 / el expense está soft-deleted.
    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const expenseTxs = txs.filter((t) => t.expenseId === expense.id);
    expect(expenseTxs.length).toBe(0);
    expect(txs.find((t) => t.category === 'EXPENSE_REVERSAL')).toBeUndefined();

    const audit = await apiGetExpenseAudit(token, expense.id);
    const del = audit.find((a) => a.action === 'DELETE');
    expect(del).toBeDefined();
    expect(del?.reason).toBe('Gasto duplicado por error');
  });

  test('delete sin motivo (o muy corto) devuelve 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `NRR${Date.now().toString().slice(-7)}` });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'OTRO',
      amount: 30_000,
      isPaid: true,
    });

    let error: Error | null = null;
    try {
      await apiDeleteExpense(token, expense.id, 'corto');
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/400/);
  });

  test('restore dentro de la ventana de 5 min revierte los reversos y restaura el gasto', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `RST${Date.now().toString().slice(-7)}` });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'IMPUESTOS',
      amount: 120_000,
      isPaid: true,
    });

    await apiDeleteExpense(token, expense.id, 'Borrado de prueba para restaurar');
    await apiRestoreExpense(token, expense.id);

    const visible = await apiListExpenses(token);
    expect(visible.find((e) => e.id === expense.id)).toBeDefined();

    // Las transactions EXPENSE_REVERSAL fueron eliminadas; queda solo la original
    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const expenseTxs = txs.filter((t) => t.expenseId === expense.id);
    expect(expenseTxs.length).toBe(1);
    expect(expenseTxs[0].category).toBe('VEHICLE_EXPENSE');

    const audit = await apiGetExpenseAudit(token, expense.id);
    expect(audit.find((a) => a.action === 'RESTORE')).toBeDefined();
  });
});
