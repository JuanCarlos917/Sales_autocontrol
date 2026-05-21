import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRequestRaw } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';
import { TEST_SEED_IDS } from '../../global-setup';

const ADMIN_EMAIL = 'admin@autocontrol.co';

test.describe('Rol VIEWER — solo lectura', () => {
  // El usuario de prueba se loguea como admin; bajamos su rol a VIEWER en DB y restauramos.
  test.afterEach(async () => {
    await setUserRole(ADMIN_EMAIL, 'ADMIN');
  });

  test('VIEWER puede leer pero NO escribir (vehículos y tesorería)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // Creamos un vehículo como ADMIN para tener un id sobre el que probar escrituras.
    const v = await apiCreateVehicle(token, { plate: `VWR${Date.now().toString().slice(-6)}` });

    await setUserRole(ADMIN_EMAIL, 'VIEWER');

    // Lecturas permitidas
    expect((await apiRequestRaw('GET', '/vehicles', token)).status).toBe(200);
    expect((await apiRequestRaw('GET', `/vehicles/${v.id}`, token)).status).toBe(200);
    expect((await apiRequestRaw('GET', '/treasury/transactions', token)).status).toBe(200);

    // Escrituras bloqueadas con 403 (antes de cualquier validación de negocio)
    expect((await apiRequestRaw('POST', '/vehicles', token, { plate: 'NOPE001' })).status).toBe(403);
    expect((await apiRequestRaw('PUT', `/vehicles/${v.id}`, token, { notes: 'x' })).status).toBe(403);
    expect((await apiRequestRaw('PATCH', `/vehicles/${v.id}/stage`, token, { stage: 'COMPRADO' })).status).toBe(403);
    expect((await apiRequestRaw('DELETE', `/vehicles/${v.id}`, token)).status).toBe(403);
    expect((await apiRequestRaw('POST', '/treasury/transactions/income', token, {
      accountId: TEST_SEED_IDS.accountCash, amount: 1000, category: 'OTHER_INCOME',
    })).status).toBe(403);
  });

  test('VIEWER conserva las acciones de sesión (logout no se bloquea)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'VIEWER');

    // /auth no está sujeto al bloqueo de solo-lectura.
    const res = await apiRequestRaw('POST', '/auth/logout', token, { refreshToken: 'dummy' });
    expect(res.status).not.toBe(403);
  });

  test('UI en modo consulta: muestra el badge y oculta crear vehículo', async ({ page }) => {
    await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'VIEWER');
    await page.reload(); // AuthContext re-lee /auth/me con el nuevo rol

    await expect(page.getByTestId('viewer-readonly-badge')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('kanban-create-vehicle')).toHaveCount(0);
  });
});
