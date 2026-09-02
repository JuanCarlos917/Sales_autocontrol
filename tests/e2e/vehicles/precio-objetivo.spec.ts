import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Precio objetivo de venta — tarjeta de detalle y meta del pipeline', () => {
  test('detalle del vehículo muestra la tarjeta "Precio Objetivo" con su semáforo de cumplimiento', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // purchasePrice 20M + margen global por defecto (15%) → objetivo ≈ 23M.
    // listedPrice 40M lo supera con margen holgado (cubre cualquier prorrateo de
    // fijos por días en inventario), así que el estado siempre es "Cumple meta".
    const v = await apiCreateVehicle(token, {
      plate: `TGT${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 40_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await page.goto(`/vehicles/${v.id}?tab=financiero`);

    // La tarjeta solo aparece cuando m.targetPrice > 0 (requiere purchasePrice).
    await expect(page.getByText('Precio Objetivo')).toBeVisible({ timeout: 10_000 });
    // Sin override por vehículo → usa el margen global, no uno personalizado.
    await expect(page.getByText(/\(global\)/)).toBeVisible();
    // listedPrice (40M) >= precio objetivo (~23M) → semáforo verde "Cumple meta".
    await expect(page.getByText('Cumple meta')).toBeVisible();
    await expect(page.getByText('Rentable, bajo meta')).toHaveCount(0);
    await expect(page.getByText('No cubre meta')).toHaveCount(0);
    await expect(page.getByText(/Ganancia objetivo:/)).toBeVisible();
    await expect(page.getByText(/Brecha:/)).toBeVisible();
  });

  test('dashboard muestra el bloque "Meta del pipeline" con los conteos por estado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // La DB de test se resetea por test (fixture _isolatedDb), así que este es
    // el único vehículo en un stage activo → el bloque agrega exactamente sus datos.
    await apiCreateVehicle(token, {
      plate: `PIP${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 40_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    // El Dashboard (con KPIs y el bloque de meta) vive en /dashboard; "/" es el
    // Kanban del Pipeline. Navegar directo dispara la carga de
    // /dashboard/pipeline-target con el vehículo recién creado por API.
    await page.goto('/dashboard');

    await expect(page.getByText('Meta del pipeline')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Objetivo proyectado')).toBeVisible();
    await expect(page.getByText('Publicado hoy')).toBeVisible();
    await expect(page.getByText('Brecha')).toBeVisible();
    // Único vehículo del test, en estado MEETS → 1 cumple, 0 en los otros dos.
    await expect(page.getByText('1 cumplen · 0 bajo meta · 0 sin cubrir')).toBeVisible();
  });
});
