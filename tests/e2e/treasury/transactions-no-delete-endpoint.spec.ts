import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateTreasuryIncome,
  apiDeleteTransactionRaw,
  apiDeleteTransferRaw,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Decisión de producto (2026-06-08): movimientos y transferencias son
// inmutables. Ya no existe DELETE en el API. Cualquier intento — con o sin
// reason — devuelve 404, demostrando que ni siquiera un admin con buen
// motivo puede eliminar. Las correcciones se hacen mediante:
//   - editar el gasto origen (genera EXPENSE_ADJUSTMENT)
//   - crear un nuevo movimiento manual de ajuste

test.describe('Tesorería — endpoint DELETE removido', () => {
  test('DELETE /treasury/transactions/:id → 404 con o sin reason', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 99_000,
      description: 'income para verificar 404 en DELETE',
    });

    const noReason = await apiDeleteTransactionRaw(token, income.id, {});
    expect(noReason.status).toBe(404);

    const withReason = await apiDeleteTransactionRaw(token, income.id, {
      reason: 'motivo válido pero el endpoint no debe existir',
    });
    expect(withReason.status).toBe(404);
  });

  test('DELETE /treasury/transfers/:id → 404 con o sin reason', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const transferRes = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: TEST_SEED_IDS.accountBank,
      amount: 50_000,
      description: 'transfer para verificar 404 en DELETE',
    });
    expect(transferRes.status).toBeLessThan(400);
    const transferId = (transferRes.body as { id: string }).id;

    const noReason = await apiDeleteTransferRaw(token, transferId, {});
    expect(noReason.status).toBe(404);

    const withReason = await apiDeleteTransferRaw(token, transferId, {
      reason: 'motivo válido pero el endpoint no debe existir',
    });
    expect(withReason.status).toBe(404);
  });
});
