import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';
import { apiCreateVehicle } from '../../helpers/api';
import { forceVehicleStage } from '../../helpers/db';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Pipeline — completar y mover en el drop', () => {
  test('ALISTAMIENTO → PUBLICADO: el drop pide Precio Publicado y al guardarlo mueve la card', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `PCM${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      negotiatedValue: 18_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await forceVehicleStage(v.id, 'ALISTAMIENTO');
    await page.reload();

    const card = `[data-testid="vehicle-card-${plate}"]`;
    await expect(page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });

    await html5DragAndDrop(page, card, `[data-testid="kanban-column-PUBLICADO"]`);

    // En vez de la alerta vieja, se abre el formulario para completar el campo faltante.
    const listed = page.getByTestId('vehicle-form-listed-price');
    await expect(listed).toBeVisible({ timeout: 5_000 });
    await listed.fill('32000000');
    await page.getByTestId('vehicle-form-submit').click();

    // Al guardar (campo completo) la card pasa sola a PUBLICADO.
    await expect(page.getByTestId('kanban-column-PUBLICADO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`)).toHaveCount(0);
  });

  test('ALISTAMIENTO → PUBLICADO: sin completar el campo, la card no se mueve', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `PNM${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      negotiatedValue: 18_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await forceVehicleStage(v.id, 'ALISTAMIENTO');
    await page.reload();

    await expect(page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
    await html5DragAndDrop(page, `[data-testid="vehicle-card-${plate}"]`, `[data-testid="kanban-column-PUBLICADO"]`);

    // Se abre el modal; cerramos sin completar → la card sigue en ALISTAMIENTO.
    await expect(page.getByTestId('vehicle-form-listed-price')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Cancelar/ }).click();

    await expect(page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`)).toBeVisible();
    await expect(page.getByTestId('kanban-column-PUBLICADO').getByTestId(`vehicle-card-${plate}`)).toHaveCount(0);
  });
});
