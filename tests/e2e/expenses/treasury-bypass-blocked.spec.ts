import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';

test.describe('Gastos — bypass por /treasury/transactions bloqueado', () => {
  test('PUT y DELETE sobre Transaction con expenseId devuelven 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `BYP${Date.now().toString().slice(-7)}` });

    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'TRAMITE',
      amount: 75_000,
      isPaid: true,
    });

    const txs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.accountCash });
    const expenseTx = txs.find((t) => t.expenseId === expense.id);
    expect(expenseTx).toBeDefined();

    const putRes = await page.request.put(`${API_BASE}/treasury/transactions/${expenseTx!.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { description: 'hack' },
    });
    expect(putRes.status()).toBe(403);

    const delRes = await page.request.delete(`${API_BASE}/treasury/transactions/${expenseTx!.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(403);
  });
});
