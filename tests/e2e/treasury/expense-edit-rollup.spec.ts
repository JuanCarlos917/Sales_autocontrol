import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiDeleteExpense,
  apiGetAccount,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Decisión 2026-06-08: movimientos inmutables + visibilidad total. El listing
// /treasury/transactions NO oculta EXPENSE_ADJUSTMENT ni EXPENSE_REVERSAL; cada
// uno aparece como su propia fila con reversesTransactionId apuntando al
// movimiento original. El balance de las cuentas sigue saliendo bien porque
// originales + ajustes + reversos están matemáticamente compensados.

type Row = { id: string; category: string; amount: string | number; accountId: string; type: string };

test.describe('Tesorería — visibilidad de ajustes y reversos de gastos', () => {
  test('editar monto de gasto pagado: listing muestra original + ADJUSTMENT y balance refleja monto nuevo', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `EDM${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 600_000,
      description: 'Llantas',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, { amount: 700_000, reason: 'Corrección de monto por factura' });

    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = ((res.body as { transactions?: Row[] }).transactions || [])
      .filter((t) => t.category === 'VEHICLE_EXPENSE' || t.category === 'EXPENSE_ADJUSTMENT');

    expect(txs).toHaveLength(2);
    const original = txs.find((t) => t.category === 'VEHICLE_EXPENSE');
    const adjustment = txs.find((t) => t.category === 'EXPENSE_ADJUSTMENT');
    expect(original).toBeDefined();
    expect(adjustment).toBeDefined();
    expect(Number(original!.amount)).toBe(600_000);
    expect(Number(adjustment!.amount)).toBe(100_000); // delta
    expect(adjustment!.type).toBe('EXPENSE'); // monto subió → cargo adicional

    // Balance: 100M - 600k - 100k = 100M - 700k
    const acc = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    expect(Number(acc.currentBalance)).toBe(100_000_000 - 700_000);
  });

  test('borrar gasto pagado: listing muestra original + REVERSAL y balance vuelve al inicial', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `EDD${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 500_000,
      description: 'Frenos',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiDeleteExpense(token, expense.id, 'Fue cargado por error y se elimina');

    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = ((res.body as { transactions?: Row[] }).transactions || [])
      .filter((t) => t.category === 'VEHICLE_EXPENSE' || t.category === 'EXPENSE_REVERSAL');

    expect(txs).toHaveLength(2);
    const original = txs.find((t) => t.category === 'VEHICLE_EXPENSE');
    const reversal = txs.find((t) => t.category === 'EXPENSE_REVERSAL');
    expect(original).toBeDefined();
    expect(reversal).toBeDefined();
    expect(Number(original!.amount)).toBe(500_000);
    expect(Number(reversal!.amount)).toBe(500_000);
    expect(reversal!.type).toBe('INCOME'); // reverso compensa el EXPENSE original

    const acc = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    expect(Number(acc.currentBalance)).toBe(100_000_000);
  });

  test('editar cuenta de gasto pagado: listing muestra original en cash + ADJUSTMENT INCOME en cash + ADJUSTMENT EXPENSE en bank', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `EDA${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'ESTETICA',
      amount: 200_000,
      description: 'Lavado',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, {
      accountId: TEST_SEED_IDS.accountBank,
      reason: 'Pago salió del banco, no de caja',
    });

    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = ((res.body as { transactions?: Row[] }).transactions || [])
      .filter((t) => t.category === 'VEHICLE_EXPENSE' || t.category === 'EXPENSE_ADJUSTMENT');

    expect(txs).toHaveLength(3);
    const original = txs.find((t) => t.category === 'VEHICLE_EXPENSE');
    const adjustments = txs.filter((t) => t.category === 'EXPENSE_ADJUSTMENT');
    expect(original).toBeDefined();
    expect(adjustments).toHaveLength(2);

    expect(original!.accountId).toBe(TEST_SEED_IDS.accountCash);
    expect(Number(original!.amount)).toBe(200_000);

    const reverseInCash = adjustments.find(
      (a) => a.accountId === TEST_SEED_IDS.accountCash && a.type === 'INCOME',
    );
    const chargeInBank = adjustments.find(
      (a) => a.accountId === TEST_SEED_IDS.accountBank && a.type === 'EXPENSE',
    );
    expect(reverseInCash).toBeDefined();
    expect(chargeInBank).toBeDefined();
    expect(Number(reverseInCash!.amount)).toBe(200_000);
    expect(Number(chargeInBank!.amount)).toBe(200_000);
  });
});
