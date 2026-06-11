import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiGetVehicleTimeline,
  apiUpdateVehicle,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Vehículos — endpoint /vehicles/:id/timeline', () => {
  test('timeline une VehicleAudit + ExpenseAudit + Transaction y ordena desc', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `TML${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 10_000_000,
      purchasePrice: 10_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 250_000,
      description: 'frenos',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, {
      amount: 350_000,
      reason: 'factura con repuesto adicional',
    });

    const { events } = await apiGetVehicleTimeline(token, v.id);
    expect(events.length).toBeGreaterThan(0);

    // ExpenseAudit: CREATE + UPDATE
    const expenseEvents = events.filter((e) => e.type === 'EXPENSE_AUDIT');
    expect(expenseEvents.length).toBeGreaterThanOrEqual(2);
    expect(expenseEvents.some((e) => e.action === 'CREATE')).toBe(true);
    expect(expenseEvents.some((e) => e.action === 'UPDATE')).toBe(true);

    // Transaction: original VEHICLE_EXPENSE + ADJUSTMENT
    const txEvents = events.filter((e) => e.type === 'TRANSACTION');
    expect(txEvents.some((e) => e.category === 'VEHICLE_EXPENSE')).toBe(true);
    expect(txEvents.some((e) => e.category === 'EXPENSE_ADJUSTMENT')).toBe(true);

    // Orden descendente
    const dates = events.map((e) => new Date(e.createdAt).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  test('edición de campo del vehículo aparece como VEHICLE_AUDIT UPDATE en el timeline', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `TMS${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 8_000_000,
      purchasePrice: 8_000_000,
      supplierId: TEST_SEED_IDS.supplier,
      brand: 'Renault',
    });
    await apiUpdateVehicle(token, v.id, { brand: 'Toyota' });

    const { events } = await apiGetVehicleTimeline(token, v.id);
    const update = events.find(
      (e) => e.type === 'VEHICLE_AUDIT' && e.action === 'UPDATE',
    );
    expect(update).toBeDefined();
  });
});
