import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateTreasuryIncome } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Decisión de producto (2026-06-08): los movimientos y transferencias son
// inmutables en la UI. La página /treasury/transactions NO expone ningún
// botón de eliminar. Las correcciones se hacen creando nuevos movimientos
// o editando el gasto origen.

test.describe('Tesorería — movimientos inmutables en UI', () => {
  test('TransactionsPage no muestra botón de eliminar en ninguna fila', async ({ page }) => {
    const token = await loginAsAdmin(page);

    // Garantiza al menos una fila visible.
    await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 123_000,
      description: 'fila para verificar ausencia de delete UI',
    });

    await page.goto('/treasury/transactions');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

    // Ningún botón con data-testid tx-delete-* ni transfer-delete-*
    await expect(page.locator('[data-testid^="tx-delete-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="transfer-delete-"]')).toHaveCount(0);

    // Defensa adicional: el modal de motivo nunca se renderiza inicialmente.
    await expect(page.locator('[data-testid="reason-prompt-modal"]')).toHaveCount(0);
  });
});
