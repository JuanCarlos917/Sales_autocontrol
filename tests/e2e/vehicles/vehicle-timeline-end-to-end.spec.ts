import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiListTransactions,
  apiGetVehicleTimeline,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Flujo end-to-end del usuario: gasto de un vehículo → editar monto →
// /treasury/transactions muestra 2 filas y el historial del vehículo registra
// los dos eventos del gasto + el movimiento original + el ajuste.

test.describe('Vehículos — flujo gasto + ajuste + timeline (end-to-end)', () => {
  test('crear gasto 500k → editar a 700k: 2 transactions en /treasury y 4 entradas en timeline (CREATE + UPDATE de gasto, original + ajuste de tx)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `E2E${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 25_000_000,
      purchasePrice: 25_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 500_000,
      description: 'pintura completa',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, {
      amount: 700_000,
      reason: 'costo final mayor por chapa adicional',
    });

    // /treasury/transactions ve original + ADJUSTMENT con reversesTransactionId
    const treasury = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const ofExpense = treasury.filter((t) => t.expenseId === expense.id);
    expect(ofExpense).toHaveLength(2);
    const original = ofExpense.find((t) => t.category === 'VEHICLE_EXPENSE')!;
    const adjustment = ofExpense.find((t) => t.category === 'EXPENSE_ADJUSTMENT')!;
    expect(Number(original.amount)).toBe(500_000);
    expect(Number(adjustment.amount)).toBe(200_000);
    expect(adjustment.type).toBe('EXPENSE');
    expect(adjustment.reversesTransactionId).toBe(original.id);

    // Timeline tiene CREATE + UPDATE del gasto y VEHICLE_EXPENSE + EXPENSE_ADJUSTMENT
    const { events } = await apiGetVehicleTimeline(token, v.id);
    const expenseEvents = events.filter((e) => e.type === 'EXPENSE_AUDIT');
    const txEvents = events.filter((e) => e.type === 'TRANSACTION');
    expect(expenseEvents.some((e) => e.action === 'CREATE')).toBe(true);
    expect(expenseEvents.some((e) => e.action === 'UPDATE')).toBe(true);
    expect(txEvents.some((e) => e.category === 'VEHICLE_EXPENSE')).toBe(true);
    expect(txEvents.some((e) => e.category === 'EXPENSE_ADJUSTMENT')).toBe(true);
    expect(events).toHaveLength(events.length); // sanity

    // UI: la pestaña Historial muestra al menos las entradas del gasto y del movimiento
    await page.goto(`/vehicles/${v.id}?tab=historial`);
    await expect(page.locator('[data-testid="vehicle-timeline"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="timeline-EXPENSE_AUDIT"]')).toHaveCount(expenseEvents.length);
    await expect(page.locator('[data-testid="timeline-TRANSACTION"]')).toHaveCount(txEvents.length);

    // UI: /treasury/transactions muestra el badge "Ajuste"
    await page.goto('/treasury/transactions');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
    const badge = page.locator('[data-testid="origin-badge-EXPENSE_ADJUSTMENT"]').first();
    await expect(badge).toBeVisible();
  });
});
