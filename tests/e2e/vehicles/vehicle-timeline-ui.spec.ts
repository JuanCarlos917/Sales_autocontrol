import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Vehículos — pestaña Historial renderiza eventos heterogéneos', () => {
  test('crear + editar gasto produce entradas EXPENSE_AUDIT y TRANSACTION en el timeline UI', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `TUI${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 12_000_000,
      purchasePrice: 12_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 300_000,
      description: 'cambio de aceite',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, {
      amount: 380_000,
      reason: 'mecánico cobró revisión adicional',
    });

    await page.goto(`/vehicles/${v.id}?tab=historial`);
    await expect(page.locator('[data-testid="vehicle-timeline"]')).toBeVisible({ timeout: 10_000 });

    // Al menos una entrada de gasto y una de movimiento
    await expect(page.locator('[data-testid="timeline-EXPENSE_AUDIT"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="timeline-TRANSACTION"]').first()).toBeVisible();
  });
});
