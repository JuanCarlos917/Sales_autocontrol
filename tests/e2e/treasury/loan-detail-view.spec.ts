import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateLoan, apiAddLoanPayment, apiCreateDebt, apiAddDebtPayment } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — vista de detalle de préstamos y créditos', () => {
  test('préstamo: "Ver detalle" abre /treasury/loans/:id con resumen, pagos y cronograma', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 2_000_000,
      interestRate: 12,
      // Las cuotas deben sumar principal + interés (2.000.000 + 12% = 2.240.000).
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_120_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_120_000 },
      ],
    });
    // El pago de préstamo es un INGRESO (no requiere saldo en la cuenta destino).
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 1_000_000,
      notes: 'pago prestamo detalle',
    });

    await page.goto('/treasury/loans');
    await page.getByTestId(`loan-card-${loan.id}-detail-link`).click();

    await expect(page).toHaveURL(new RegExp(`/treasury/loans/${loan.id}$`));
    await expect(page.getByTestId('loan-detail-page')).toBeVisible();

    // Resumen: tasa pactada y cuotas pagadas/pactadas.
    await expect(page.getByTestId('loan-detail-kpi-rate')).toContainText('12');
    await expect(page.getByTestId('loan-detail-kpi-installments')).toContainText('/ 2');

    // Sección de pagos muestra la observación.
    await expect(page.getByTestId('loan-detail-details')).toContainText('pago prestamo detalle');

    // Cronograma muestra filas con estado.
    const schedule = page.getByTestId('loan-detail-schedule');
    await expect(schedule).toBeVisible();
    await expect(page.getByTestId('loan-detail-schedule-row-1')).toBeVisible();
    await expect(page.getByTestId('loan-detail-schedule-row-2')).toBeVisible();
  });

  test('crédito: "Ver detalle" abre /treasury/debts/:id sin tasa ni intereses', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const debt = await apiCreateDebt(token, {
      name: 'Crédito detalle',
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_000_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_000_000 },
      ],
    });
    // El pago de crédito es un EGRESO: usar una cuenta con saldo (Caja seed = 100M).
    await apiAddDebtPayment(token, debt.id, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 1_000_000,
      notes: 'pago credito detalle',
    });

    await page.goto('/treasury/debts');
    await page.getByTestId(`debt-card-${debt.id}-detail-link`).click();

    await expect(page).toHaveURL(new RegExp(`/treasury/debts/${debt.id}$`));
    await expect(page.getByTestId('debt-detail-page')).toBeVisible();

    // Resumen de crédito: cuotas pagadas/pactadas, sin tasa ni intereses.
    await expect(page.getByTestId('debt-detail-kpi-installments')).toContainText('/ 2');
    await expect(page.getByTestId('debt-detail-kpi-total')).toBeVisible();
    await expect(page.getByTestId('debt-detail-kpi-rate')).toHaveCount(0);
    await expect(page.getByTestId('debt-detail-kpi-interest')).toHaveCount(0);

    // Pagos y cronograma.
    await expect(page.getByTestId('debt-detail-details')).toContainText('pago credito detalle');
    await expect(page.getByTestId('debt-detail-schedule-row-1')).toBeVisible();
  });

  test('préstamo inexistente muestra "no encontrado"', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/treasury/loans/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('loan-detail-not-found')).toBeVisible();
  });
});
