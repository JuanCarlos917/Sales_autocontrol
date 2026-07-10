import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiPinLogin, apiRequestRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Hallazgos 🟡 #8/#19 + #12 de la auditoría: COP no maneja decimales
// (regla de negocio en CLAUDE.md), pero los schemas de montos aceptaban
// floats y sin tope (Decimal(15,2) desborda con 500 de Prisma). Además la
// UI de préstamos generaba cuotas con centavos que el backend rechaza.

test.describe('Tesorería — montos COP enteros y acotados', () => {
  test('ingreso con centavos se rechaza (COP es entero)', async () => {
    const token = await apiPinLogin();
    const res = await apiRequestRaw('POST', '/treasury/transactions/income', token, {
      accountId: TEST_SEED_IDS.accountCash,
      category: 'OTHER_INCOME',
      amount: 100000.5,
    });
    expect(res.status).toBe(400);
  });

  test('egreso y transferencia con centavos se rechazan', async () => {
    const token = await apiPinLogin();
    const expense = await apiRequestRaw('POST', '/treasury/transactions/expense', token, {
      accountId: TEST_SEED_IDS.accountCash,
      category: 'OTHER_EXPENSE',
      amount: 5000.99,
    });
    expect(expense.status).toBe(400);

    const transfer = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: TEST_SEED_IDS.accountBank,
      amount: 1000.01,
    });
    expect(transfer.status).toBe(400);
  });

  test('monto que desborda Decimal(15,2) devuelve 400, no 500', async () => {
    const token = await apiPinLogin();
    const res = await apiRequestRaw('POST', '/treasury/transactions/income', token, {
      accountId: TEST_SEED_IDS.accountCash,
      category: 'OTHER_INCOME',
      amount: 100_000_000_000_000, // 10^14 > Decimal(15,2)
    });
    expect(res.status).toBe(400);
  });

  test('crear préstamo de 1.000.000 en 3 cuotas por la UI funciona (cuotas enteras)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/treasury/loans');
    await page.getByTestId('loans-create-button').click();
    await page.getByTestId('loan-form-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('loan-form-principal').fill('1000000');
    await page.getByTestId('loan-form-installments-count').fill('3'); // 1M/3 no es entero
    await page.getByTestId('loan-form-frequency').selectOption('MONTHLY');
    await page.getByTestId('loan-form-generate').click();
    await page.getByTestId('loan-form-submit').click();

    // El modal cierra y el préstamo aparece — hoy el backend rechaza las
    // cuotas con centavos (400) y el préstamo nunca se crea.
    await expect(page.getByTestId('loan-form-submit')).toHaveCount(0, { timeout: 10_000 });
  });
});
