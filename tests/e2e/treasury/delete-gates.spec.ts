import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiCreateAccount, apiRequestRaw } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';

// Hallazgo 🟠 #6 de la auditoría: DELETE /accounts/:id y /third-parties/:id
// eran la "puerta trasera" del reverso auditable — sin gate ADMIN y sin traza.

const ADMIN_EMAIL = 'admin@autocontrol.co';

test.describe('Tesorería — hard-deletes con gate ADMIN y auditoría', () => {
  test.afterEach(async () => { await setUserRole(ADMIN_EMAIL, 'ADMIN'); });

  test('SUPERVISOR no puede borrar cuentas', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Borrable ${Date.now()}`, type: 'CASH', initialBalance: 0,
    });
    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    const res = await apiRequestRaw('DELETE', `/treasury/accounts/${account.id}`, token, undefined);
    expect(res.status).toBe(403);
  });

  test('SUPERVISOR no puede borrar terceros', async () => {
    const token = await apiPinLogin();
    const created = await apiRequestRaw('POST', '/treasury/third-parties', token, {
      name: `Tercero borrable ${Date.now()}`, type: 'CLIENT',
    });
    expect(created.status).toBe(201);
    const tpId = (created.body as { id: string }).id;

    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    const res = await apiRequestRaw('DELETE', `/treasury/third-parties/${tpId}`, token, undefined);
    expect(res.status).toBe(403);
  });

  test('borrar una cuenta (ADMIN) deja entrada DELETE en el audit log', async () => {
    const token = await apiPinLogin();
    const account = await apiCreateAccount(token, {
      name: `Auditada ${Date.now()}`, type: 'CASH', initialBalance: 0,
    });
    const del = await apiRequestRaw('DELETE', `/treasury/accounts/${account.id}`, token, undefined);
    expect(del.status).toBe(200);

    const audit = await apiRequestRaw(
      'GET',
      `/treasury/audit?entityType=ACCOUNT&entityId=${account.id}`,
      token,
      undefined,
    );
    expect(audit.status).toBe(200);
    const entries = audit.body as Array<{ action: string }>;
    expect(entries.some((e) => e.action === 'DELETE')).toBe(true);
  });
});
