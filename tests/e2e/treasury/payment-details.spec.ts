import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateLoan, apiAddLoanPayment, apiCreateDebt, apiAddDebtPayment } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — Detalles de pagos en cards', () => {
  test('préstamo: la card muestra el pago en Detalles (fecha, valor, observación)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 2_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 2_000_000 }],
    });
    // El pago de préstamo es un INGRESO (no requiere saldo en la cuenta destino).
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 1_000_000,
      notes: 'pago prestamo de prueba',
    });

    await page.goto('/treasury/loans');
    await page.getByTestId(`loan-card-${loan.id}-details-toggle`).click();
    const details = page.getByTestId(`loan-card-${loan.id}-details`);
    await expect(details).toBeVisible();
    await expect(details).toContainText('pago prestamo de prueba');
  });

  test('crédito: la card muestra el pago en Detalles', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const debt = await apiCreateDebt(token, {
      name: 'Crédito detalles',
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 1_000_000 }],
    });
    // El pago de crédito es un EGRESO: usar una cuenta con saldo (Caja seed = 100M).
    await apiAddDebtPayment(token, debt.id, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 1_000_000,
      notes: 'pago credito de prueba',
    });

    await page.goto('/treasury/debts');
    await page.getByTestId(`debt-card-${debt.id}-details-toggle`).click();
    const details = page.getByTestId(`debt-card-${debt.id}-details`);
    await expect(details).toBeVisible();
    await expect(details).toContainText('pago credito de prueba');
  });
});
