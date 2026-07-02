import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateAccount, apiGetAccount, apiReverseAccountRaw } from '../../helpers/api';

test.describe('Tesorería — desactivar cuenta (API)', () => {
  test('desactivar una cuenta vacía la marca inactiva y no se repite', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, { name: 'Cuenta vacía a desactivar', type: 'BANK' });

    const res = await apiReverseAccountRaw(token, acc.id, 'cuenta creada por error');
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    const fetched = await apiGetAccount(token, acc.id);
    expect(fetched.isActive).toBe(false);

    // Doble desactivación → 409
    expect((await apiReverseAccountRaw(token, acc.id, 'cuenta creada por error')).status).toBe(409);
  });

  test('cuenta con movimientos/saldo no se puede desactivar → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, {
      name: 'Cuenta con saldo inicial',
      type: 'CASH',
      initialBalance: 5_000_000,
    });
    const res = await apiReverseAccountRaw(token, acc.id, 'intento con saldo');
    expect(res.status).toBe(403);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, { name: 'Cuenta motivo corto', type: 'BANK' });
    expect((await apiReverseAccountRaw(token, acc.id, 'corto')).status).toBe(400);
  });

  test('cuenta inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseAccountRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
