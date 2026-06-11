import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — UI badge de Ajuste / Reverso', () => {
  test('editar gasto pagado: TransactionsPage muestra fila con badge "Ajuste"', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `BDG${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 15_000_000,
      purchasePrice: 15_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const { expense } = await apiCreateExpense(token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 400_000,
      description: 'aceite',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: true,
    });
    await apiUpdateExpense(token, expense.id, {
      amount: 500_000,
      reason: 'cotización corregida',
    });

    await page.goto('/treasury/transactions');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

    const badge = page.locator('[data-testid="origin-badge-EXPENSE_ADJUSTMENT"]').first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Ajuste/);
  });
});
