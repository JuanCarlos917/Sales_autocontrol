import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiUpdateVehicle,
  apiUpdateVehicleRaw,
  apiGetVehicleAudit,
} from '../../helpers/api';
import { forceVehicleStage, setUserRole } from '../../helpers/db';

const ADMIN_EMAIL = 'admin@autocontrol.co';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

test.describe('Vehículos — lock de edición por etapa y rol', () => {
  // El usuario de prueba se loguea siempre como admin (PIN). Cada test ajusta su
  // rol en DB según lo que necesite. Restauramos a ADMIN para no contaminar otros tests.
  test.afterEach(async () => {
    await setUserRole(ADMIN_EMAIL, 'ADMIN');
  });

  test('SUPERVISOR + COMPRADO: editar marca (identity) devuelve 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('SUP'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'COMPRADO');

    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    const res = await apiUpdateVehicleRaw(token, v.id, { brand: 'Mazda' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrador/i);
  });

  test('SUPERVISOR + COMPRADO: editar notas (no identity) devuelve 200', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('SNT'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'COMPRADO');

    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    const res = await apiUpdateVehicleRaw(token, v.id, { notes: 'Pendiente de alistamiento' });

    expect(res.status).toBe(200);
  });

  test('ADMIN + COMPRADO: editar marca devuelve 200 y registra audit UPDATE', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('ADM'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'COMPRADO');

    await setUserRole(ADMIN_EMAIL, 'ADMIN');
    const updated = await apiUpdateVehicle(token, v.id, { brand: 'Mazda' });
    expect(updated.brand).toBe('Mazda');

    const audit = await apiGetVehicleAudit(token, v.id);
    const updates = audit.filter((a) => a.action === 'UPDATE');
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  test('ADMIN + VENDIDO: cualquier edición (incluso notas) devuelve 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('AVD'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'VENDIDO');

    await setUserRole(ADMIN_EMAIL, 'ADMIN');
    const res = await apiUpdateVehicleRaw(token, v.id, { notes: 'No debería poder' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/VENDIDO/i);
  });

  test('SUPERVISOR + VENDIDO: cualquier edición devuelve 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('SVD'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'VENDIDO');

    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    const res = await apiUpdateVehicleRaw(token, v.id, { brand: 'Mazda' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/VENDIDO/i);
  });

  test('ADMIN + COMPRADO: el audit UPDATE captura before/after correctos', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: plate('AUD'), brand: 'Chevrolet' });
    await forceVehicleStage(v.id, 'COMPRADO');

    await setUserRole(ADMIN_EMAIL, 'ADMIN');
    await apiUpdateVehicle(token, v.id, { brand: 'Renault' });

    const audit = await apiGetVehicleAudit(token, v.id);
    const update = audit.find((a) => a.action === 'UPDATE');
    expect(update).toBeDefined();
    expect((update!.before as Record<string, unknown>)?.brand).toBe('Chevrolet');
    expect((update!.after as Record<string, unknown>)?.brand).toBe('Renault');
    expect(update!.user.email).toBe(ADMIN_EMAIL);
  });
});
