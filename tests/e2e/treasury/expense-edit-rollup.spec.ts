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

// El backend crea EXPENSE_ADJUSTMENT al editar monto/cuenta y EXPENSE_REVERSAL al
// borrar, para preservar audit trail. Pero el endpoint /treasury/transactions debe
// ocultar ese ruido y mostrar cada gasto una vez con su estado ACTUAL (después de
// la edición), o no mostrarlo si fue borrado. El balance de cuenta sí se calcula
// sobre todas las transacciones (originales + adjustments + reversals), que están
// matemáticamente compensadas.

test.describe('Tesorería — rollup de gastos editados/borrados', () => {
  test('editar monto de gasto pagado: listing muestra 1 transaction con el monto NUEVO', async ({ page }) => {
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
    await apiUpdateExpense(token, expense.id, { amount: 700_000, reason: 'Corrección de monto' });

    // En DB hay: VEHICLE_EXPENSE 600 + EXPENSE_ADJUSTMENT 100. Listing debe colapsar a 1.
    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = (res.body as { transactions?: Array<{ category: string; amount: string }> }).transactions || [];
    const expenseTxs = txs.filter(t => t.category === 'VEHICLE_EXPENSE');
    expect(expenseTxs).toHaveLength(1);
    expect(Number(expenseTxs[0].amount)).toBe(700_000);

    // Y ningún ADJUSTMENT debe asomar en el listing
    expect(txs.find(t => t.category === 'EXPENSE_ADJUSTMENT')).toBeUndefined();

    // El balance de cuenta refleja el descuento real (700k)
    const acc = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    // initial 100M - compra (no aplica aquí) - 700k = 99.3M (con seed inicial 100M)
    expect(Number(acc.currentBalance)).toBe(100_000_000 - 700_000);
  });

  test('borrar gasto pagado: listing no muestra la transaction (queda solo audit en DB)', async ({ page }) => {
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
    await apiDeleteExpense(token, expense.id, 'Fue cargado por error');

    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = (res.body as { transactions?: Array<{ category: string; amount: string }> }).transactions || [];
    // Sin VEHICLE_EXPENSE, sin REVERSAL en el listing
    expect(txs.find(t => t.category === 'VEHICLE_EXPENSE')).toBeUndefined();
    expect(txs.find(t => t.category === 'EXPENSE_REVERSAL')).toBeUndefined();

    // Balance vuelve al inicial (la transacción original + el reverso se cancelan)
    const acc = await apiGetAccount(token, TEST_SEED_IDS.accountCash);
    expect(Number(acc.currentBalance)).toBe(100_000_000);
  });

  test('editar cuenta de gasto pagado: listing muestra 1 transaction en la cuenta NUEVA', async ({ page }) => {
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
    await apiUpdateExpense(token, expense.id, { accountId: TEST_SEED_IDS.accountBank, reason: 'Pago salió del banco' });

    // En DB: VEHICLE_EXPENSE en cash + ADJUSTMENT reverso en cash + ADJUSTMENT cargo en bank.
    // Listing debe colapsar a 1 sola transaction visible en cuenta bank.
    const res = await apiRequestRaw('GET', `/treasury/transactions?vehicleId=${v.id}`, token);
    const txs = (res.body as { transactions?: Array<{ category: string; amount: string; accountId: string }> }).transactions || [];
    const expenseTxs = txs.filter(t => t.category === 'VEHICLE_EXPENSE');
    expect(expenseTxs).toHaveLength(1);
    expect(expenseTxs[0].accountId).toBe(TEST_SEED_IDS.accountBank);
    expect(Number(expenseTxs[0].amount)).toBe(200_000);
  });
});
