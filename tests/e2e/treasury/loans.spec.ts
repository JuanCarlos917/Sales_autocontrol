import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — préstamos internos', () => {
  test('crear préstamo de 5M en 5 cuotas y registrar primer pago', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const PRINCIPAL = 5_000_000;
    const INSTALLMENT = 1_000_000;

    const cashBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    await page.goto('/treasury/loans');

    await page.getByTestId('loans-create-button').click();

    await page.getByPlaceholder(/Buscar o crear/).click();
    await page.getByRole('button', { name: /Empleado Test/ }).first().click();

    await page.getByTestId('loan-form-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('loan-form-principal').fill(String(PRINCIPAL));
    await page.getByTestId('loan-form-installments-count').fill('5');
    await page.getByTestId('loan-form-frequency').selectOption('MONTHLY');
    await page.getByTestId('loan-form-generate').click();

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/loans') && r.request().method() === 'POST' && r.status() === 201,
      ),
      page.getByTestId('loan-form-submit').click(),
    ]);

    const cashAfterDisburse = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    expect(cashBefore - cashAfterDisburse).toBe(PRINCIPAL);

    const card = page.locator('[data-testid^="loan-card-"]').first();
    await expect(card).toBeVisible();

    const payButton = card.locator('[data-testid$="-pay-button"]');
    await payButton.click();

    await page.getByTestId('loan-payment-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('loan-payment-principal').fill(String(INSTALLMENT));

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/loans/') && r.url().includes('/payments') && r.status() === 201,
      ),
      page.getByTestId('loan-payment-submit').click(),
    ]);

    const cashAfterPay = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankAfterPay = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    expect(cashBefore - cashAfterPay).toBe(PRINCIPAL);
    expect(bankAfterPay - bankBefore).toBe(INSTALLMENT);
  });

  test('pago con monto extra: principal va a saldo, extra va a ingreso adicional', async ({ page }) => {
    const token = await loginAsAdmin(page);

    const today = new Date().toISOString().slice(0, 10);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 3_000_000,
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_500_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_500_000 },
      ],
    });

    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    await page.goto('/treasury/loans');
    const card = page.getByTestId(`loan-card-${loan.id}`);
    await card.locator('[data-testid$="-pay-button"]').click();

    await page.getByTestId('loan-payment-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('loan-payment-principal').fill('1500000');
    await page.getByTestId('loan-payment-extra').fill('200000');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/loans/') && r.url().includes('/payments') && r.status() === 201,
      ),
      page.getByTestId('loan-payment-submit').click(),
    ]);

    const bankAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );
    expect(bankAfter - bankBefore).toBe(1_700_000);

    const updated = await apiGetLoan(token, loan.id);
    expect(parseFloat(updated.paidAmount as string)).toBe(1_500_000);
    expect(parseFloat(updated.extraReceived as string)).toBe(200_000);
  });

  test('rechaza pago de principal mayor al saldo pendiente con error 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 4_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 4_000_000 }],
    });

    let error: Error | null = null;
    try {
      await apiAddLoanPayment(token, loan.id, {
        accountId: TEST_SEED_IDS.accountBank,
        principalAmount: 10_000_000,
      });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/excede el saldo pendiente/i);
  });
});
