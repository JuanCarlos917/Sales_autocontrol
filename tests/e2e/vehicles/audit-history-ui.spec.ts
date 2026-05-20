import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiUpdateVehicle } from '../../helpers/api';
import { forceVehicleStage } from '../../helpers/db';

test.describe('Vehículos — historial de auditoría en VehicleDetailPage', () => {
  test('la pestaña Historial muestra la edición de un campo de identidad', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `HIS${Date.now().toString().slice(-6)}`,
      brand: 'Chevrolet',
    });
    await forceVehicleStage(v.id, 'COMPRADO');
    await apiUpdateVehicle(token, v.id, { brand: 'Mazda' });

    await page.goto(`/vehicles/${v.id}?tab=historial`);

    const entry = page.getByTestId('vehicle-audit-entry').first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Edición');
    await expect(entry).toContainText('Marca');
    await expect(entry).toContainText('Chevrolet');
    await expect(entry).toContainText('Mazda');
  });

  test('un vehículo recién creado muestra el estado vacío del historial', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, { plate: `HE${Date.now().toString().slice(-6)}` });

    await page.goto(`/vehicles/${v.id}?tab=historial`);

    await expect(page.getByTestId('vehicle-audit-empty')).toBeVisible();
  });
});
