import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiDeleteExpense,
  apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Decisión 2026-06-08: movimientos inmutables + trazabilidad total.
// /treasury/transactions deja de aplicar rollup y devuelve cada Transaction
// como una fila separada. Editar/borrar un gasto pagado genera filas
// EXPENSE_ADJUSTMENT / EXPENSE_REVERSAL que son visibles en el listado, con
// reversesTransactionId apuntando a la transaction original.

test.describe('Tesorería — movimientos muestran ajustes y reversos', () => {
  test('editar monto de gasto pagado: listing muestra original + EXPENSE_ADJUSTMENT', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `ADJ${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 500_000,
      description: 'pintura',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });

    // Subir el monto a 700k → genera EXPENSE_ADJUSTMENT EXPENSE +200k
    await apiUpdateExpense(token, expense.id, {
      amount: 700_000,
      reason: 'cotización corregida con factura',
    });

    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const ofExpense = txs.filter((t) => t.expenseId === expense.id);
    expect(ofExpense.length).toBe(2);

    const original = ofExpense.find((t) => t.category === 'VEHICLE_EXPENSE');
    const adjustment = ofExpense.find((t) => t.category === 'EXPENSE_ADJUSTMENT');
    expect(original).toBeDefined();
    expect(adjustment).toBeDefined();

    expect(Number(original!.amount)).toBe(500_000);
    expect(Number(adjustment!.amount)).toBe(200_000);
    expect(adjustment!.type).toBe('EXPENSE');
    // El ajuste enlaza al movimiento original via reversesTransactionId
    expect((adjustment as { reversesTransactionId?: string }).reversesTransactionId).toBe(original!.id);
  });

  test('borrar gasto pagado: listing muestra original + EXPENSE_REVERSAL', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `REV${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 18_000_000,
      purchasePrice: 18_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'IMPUESTOS',
      amount: 300_000,
      description: 'placas',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });

    await apiDeleteExpense(token, expense.id, 'gasto duplicado por error de captura');

    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const ofExpense = txs.filter((t) => t.expenseId === expense.id);
    expect(ofExpense.length).toBe(2);

    const original = ofExpense.find((t) => t.category === 'VEHICLE_EXPENSE');
    const reversal = ofExpense.find((t) => t.category === 'EXPENSE_REVERSAL');
    expect(original).toBeDefined();
    expect(reversal).toBeDefined();
    expect(reversal!.type).toBe('INCOME'); // reverso de un EXPENSE
    expect(Number(reversal!.amount)).toBe(300_000);
    expect((reversal as { reversesTransactionId?: string }).reversesTransactionId).toBe(original!.id);
  });
});
