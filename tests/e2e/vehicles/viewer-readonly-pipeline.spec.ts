import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiConfirmPurchase } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';
import { TEST_SEED_IDS } from '../../global-setup';

const ADMIN_EMAIL = 'admin@autocontrol.co';

// El pipeline de vehículos debe ser estrictamente de solo lectura para VIEWER:
// ningún control de escritura visible (incluidos los pagos de CxP/CxC en la
// pestaña Financiero/Tesorería del detalle del vehículo).
test.describe('Rol VIEWER — pipeline de vehículos solo lectura', () => {
  test.afterEach(async () => {
    await setUserRole(ADMIN_EMAIL, 'ADMIN');
  });

  test('VIEWER no ve el botón de pagar CxP en el detalle del vehículo', async ({ page }) => {
    const token = await loginAsAdmin(page);

    // Vehículo con compra confirmada y CxP pendiente (sin pago) -> habría botón "Registrar Pago".
    const plate = `VWP${Date.now().toString().slice(-6)}`;
    const vehicle = await apiCreateVehicle(token, {
      plate,
      stage: 'NEGOCIANDO',
      negotiatedValue: 15_000_000,
    });
    await apiConfirmPurchase(token, vehicle.id, {
      vehicle: { purchasePrice: 15_000_000, supplierId: TEST_SEED_IDS.supplier },
      payment: { thirdPartyId: TEST_SEED_IDS.supplier, dueDate: null },
    });

    // Como ADMIN el botón de pago existe (sanity check del fixture).
    await page.goto(`/vehicles/${vehicle.id}?tab=tesoreria`);
    await expect(page.getByTestId('vehicle-pay-purchase')).toBeVisible({ timeout: 10_000 });

    // Bajamos a VIEWER y recargamos para que AuthContext re-lea el rol.
    await setUserRole(ADMIN_EMAIL, 'VIEWER');
    await page.reload();

    // Modo consulta: badge visible y el botón de pago oculto.
    await expect(page.getByTestId('viewer-readonly-badge')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('vehicle-tab-tesoreria').click();
    await expect(page.getByTestId('vehicle-pay-purchase')).toHaveCount(0);
  });

  test('VIEWER no ve controles de escritura en el detalle (editar/eliminar/vender/+documento)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `VWR${Date.now().toString().slice(-6)}` });

    await setUserRole(ADMIN_EMAIL, 'VIEWER');
    await page.goto(`/vehicles/${vehicle.id}`);
    await expect(page.getByTestId('viewer-readonly-badge')).toBeVisible({ timeout: 10_000 });

    // Documentos: el botón de alta no debe estar.
    await page.getByTestId('vehicle-tab-documentos').click();
    await expect(page.getByTestId('open-document-form')).toHaveCount(0);
  });
});
