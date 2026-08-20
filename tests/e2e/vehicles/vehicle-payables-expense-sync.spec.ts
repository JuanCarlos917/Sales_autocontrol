import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRequestRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Vehículo — CxP de gasto: pago sincroniza el estado del gasto', () => {
  test('gasto pendiente → pagar su CxP desde el tab → gasto queda pagado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `EXP${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    // Gasto con tesorería, PENDIENTE → crea Expense(paid=false) + CxP(PENDING) ligada.
    const created = await apiRequestRaw('POST', '/expenses/with-treasury', token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 500_000,
      description: 'Reparación motor',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: false,
      dueDate: null,
    });
    expect(created.status).toBe(201);
    const payableId = created.body.payable.id as string;
    const expenseId = created.body.expense.id as string;

    // Abrir el vehículo en el tab Tesorería y pagar la CxP del gasto desde la lista.
    await page.goto(`/vehicles/${v.id}?tab=tesoreria`);
    const payBtn = page.getByTestId(`payable-pay-${payableId}`);
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();

    // Modal de pago: elegir cuenta y registrar (el monto viene precargado al total).
    await page.getByTestId('payment-modal-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('payment-modal-submit').click();

    // La CxP desaparece del botón de pago (queda PAID) y el gasto queda pagado en API.
    await expect(page.getByTestId(`payable-pay-${payableId}`)).toHaveCount(0, { timeout: 10_000 });

    const expenses = await apiRequestRaw('GET', '/expenses', token);
    const exp = (expenses.body as Array<{ id: string; paid: boolean }>).find((e) => e.id === expenseId);
    expect(exp?.paid).toBe(true);
  });
});
