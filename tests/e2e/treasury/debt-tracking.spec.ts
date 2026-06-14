import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount, apiCreateDebt, apiAddDebtPayment,
  apiReconcileDebt, apiCreateExpense, apiCreateVehicle, apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// La lista de transacciones se filtra en JS (robusto ante los filtros del endpoint).
test.describe('Tesorería — créditos/deudas del negocio', () => {
  test('crear crédito, total = suma de cuotas, sin movimiento de caja al crear', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const debt = await apiCreateDebt(token, {
      name: 'Crédito Hilux',
      lender: 'Banco X',
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 2_000_000 },
        { sequence: 2, dueDate: today, plannedAmount: 2_000_000 },
      ],
    });
    expect(parseFloat(String(debt.totalAmount))).toBe(4_000_000);
    expect(debt.status).toBe('PENDING');

    // Crear el crédito NO mueve caja
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('pagar una cuota genera egreso DEBT_PAYMENT sin vehículo y baja el saldo', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const debt = await apiCreateDebt(token, {
      name: 'Crédito local',
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_000_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_000_000 },
      ],
    });

    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    const updated = await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 1_000_000 });
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    expect(cashBefore - cashAfter).toBe(1_000_000);
    expect(parseFloat(String(updated.paidAmount))).toBe(1_000_000);
    expect(updated.status).toBe('PARTIAL');

    const txs = await apiListTransactions(token);
    const mine = txs.filter((t) => t.debtId === debt.id && t.category === 'DEBT_PAYMENT');
    expect(mine.length).toBe(1);
    expect(mine[0].vehicleId ?? null).toBeNull();
    expect(mine[0].type).toBe('EXPENSE');
  });

  test('reconciliar un egreso histórico baja el saldo sin nuevo movimiento de caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    // Vehículo de apoyo + egreso "histórico" mal categorizado contra él
    const plate = `DBT${Date.now().toString().slice(-5)}`;
    const vehicle = await apiCreateVehicle(token, { plate, brand: 'Toyota', model: 'Hilux', stage: 'COMPRADO' });
    await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountBank,
      category: 'OTRO',
      amount: 1_500_000,
      description: 'pago cuota credito historico',
    });

    const debt = await apiCreateDebt(token, {
      name: 'Crédito a reconciliar',
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 1_500_000 }],
    });

    const bankBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));

    // Encontrar la transacción del egreso histórico (filtro en JS)
    const candidates = await apiListTransactions(token);
    const histTx = candidates.find(
      (t) => typeof t.description === 'string' && t.description.includes('pago cuota credito historico'),
    );
    expect(histTx).toBeTruthy();

    const updated = await apiReconcileDebt(token, debt.id, [histTx!.id as string]);
    const bankAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));

    // Reconciliar NO mueve caja de nuevo
    expect(bankAfter).toBe(bankBefore);
    expect(parseFloat(String(updated.paidAmount))).toBe(1_500_000);
    expect(updated.status).toBe('PAID');
  });
});
