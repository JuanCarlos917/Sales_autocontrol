import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiListPayables } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Regresión: registrar un gasto como "Pendiente (CxP)" desde el modal de la
// ficha del vehículo mandaba accountId:null y el backend respondía 400
// "Datos inválidos". El modal ahora exige cuenta también para el caso pendiente.
test.describe('Gastos — CxP pendiente desde la ficha del vehículo', () => {
  test('gasto Pendiente (CxP) con cuenta crea un Payable PENDING (no 400)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `CXP${Date.now().toString().slice(-7)}` });

    await page.goto(`/vehicles/${vehicle.id}?tab=gastos`);

    await page.getByTestId('open-expense-treasury').click();

    await page.getByTestId('exp-tre-amount').fill('250000');
    await page.getByTestId('exp-tre-pending').check();

    // Esperar a que carguen las cuentas y seleccionar una explícitamente.
    const accountSelect = page.getByTestId('exp-tre-account');
    await expect(accountSelect.locator(`option[value="${TEST_SEED_IDS.accountCash}"]`)).toBeAttached({ timeout: 10_000 });
    await accountSelect.selectOption(TEST_SEED_IDS.accountCash);

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/expenses/with-treasury') &&
          r.request().method() === 'POST' &&
          r.status() === 201,
        { timeout: 10_000 },
      ),
      page.getByTestId('exp-tre-submit').click(),
    ]);

    // Se creó una CxP pendiente para este vehículo por el monto registrado.
    const payables = await apiListPayables(token);
    const created = payables.find((p) => p.vehicleId === vehicle.id && p.type === 'PAYABLE');
    expect(created).toBeDefined();
    expect(created?.status).toBe('PENDING');
    expect(parseFloat(created!.totalAmount as string)).toBe(250_000);
  });
});
