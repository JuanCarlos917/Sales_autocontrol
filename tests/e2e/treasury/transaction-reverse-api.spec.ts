import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateTreasuryIncome,
  apiReverseTransactionRaw,
  apiRequestRaw,
} from '../../helpers/api';
import { setUserRole } from '../../helpers/db';
import { TEST_SEED_IDS } from '../../global-setup';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const VALID_REASON = 'corrección: el monto fue digitado mal';

test.describe('Tesorería — reverso de movimientos manuales (API)', () => {
  test('happy path: crea compensatorio con tipo invertido y MANUAL_REVERSAL', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 80_000,
      description: 'ingreso a reversar',
    });

    const res = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(res.status).toBe(201);
    expect(res.body?.type).toBe('EXPENSE');
    expect(res.body?.category).toBe('MANUAL_REVERSAL');
    expect(res.body?.reversesTransactionId).toBe(income.id);
  });

  test('doble reverso → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 70_000,
      description: 'ingreso a reversar una sola vez',
    });
    const first = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(first.status).toBe(201);
    const second = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(second.status).toBe(409);
  });

  test('reversar un reverso → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 60_000,
      description: 'ingreso cuyo reverso intentaremos reversar',
    });
    const rev = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(rev.status).toBe(201);
    const again = await apiReverseTransactionRaw(token, rev.body!.id as string, { reason: VALID_REASON });
    expect(again.status).toBe(400);
  });

  test('id inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiReverseTransactionRaw(token, 'no-existe-id', { reason: VALID_REASON });
    expect(res.status).toBe(404);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 50_000,
      description: 'ingreso con motivo corto',
    });
    const res = await apiReverseTransactionRaw(token, income.id, { reason: 'corto' });
    expect(res.status).toBe(400);
  });

  test('movimiento ligado a transferencia → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const transferRes = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: TEST_SEED_IDS.accountBank,
      amount: 40_000,
      description: 'transfer para verificar 403 en reverse',
    });
    expect(transferRes.status).toBeLessThan(400);

    const listRes = await apiRequestRaw('GET', '/treasury/transactions?type=TRANSFER_OUT', token);
    const linked = (listRes.body as unknown as { transactions: Array<{ id: string; transferId: string | null }> })
      .transactions.find((t) => t.transferId);
    expect(linked).toBeTruthy();

    const res = await apiReverseTransactionRaw(token, linked!.id, { reason: VALID_REASON });
    expect(res.status).toBe(403);
  });

  test('no admin → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 30_000,
      description: 'ingreso para verificar guard de rol',
    });
    try {
      await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
      // authenticate re-lee el rol de la DB por request; no hace falta re-login
      const res = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
      expect(res.status).toBe(403);
    } finally {
      await setUserRole(ADMIN_EMAIL, 'ADMIN');
    }
  });
});
