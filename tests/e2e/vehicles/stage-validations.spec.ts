import { test, expect, Page } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { html5DragAndDrop } from '../../helpers/dragdrop';

async function createInNegotiating(page: Page, plate: string, negotiatedValue?: string) {
  await page.getByTestId('kanban-create-vehicle').click();
  await page.getByTestId('vehicle-form-plate').fill(plate);
  if (negotiatedValue) {
    await page.getByTestId('vehicle-form-negotiated-value').fill(negotiatedValue);
  }
  await page.getByTestId('vehicle-form-submit').click();
  await expect(page.getByTestId(`vehicle-card-${plate}`)).toBeVisible({ timeout: 10_000 });
}

async function dragTo(page: Page, plate: string, targetStage: string) {
  await html5DragAndDrop(
    page,
    `[data-testid="vehicle-card-${plate}"]`,
    `[data-testid="kanban-column-${targetStage}"]`,
  );
}

test.describe('Vehículos — validación de transiciones avanzadas', () => {
  test('NEGOCIANDO → ALISTAMIENTO bloqueado: solo permite COMPRADO como siguiente', async ({ page }) => {
    await loginAsAdmin(page);
    const plate = `SKP${Date.now().toString().slice(-7)}`;
    await createInNegotiating(page, plate, '15000000');

    await dragTo(page, plate, 'ALISTAMIENTO');

    await expect(page.getByText(/Transición no permitida/i)).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId('kanban-column-NEGOCIANDO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible();
  });

  test('COMPRADO → ALISTAMIENTO sin proveedor: abre el formulario para completar y no mueve', async ({ page }) => {
    await loginAsAdmin(page);
    const plate = `SUP${Date.now().toString().slice(-7)}`;

    await createInNegotiating(page, plate, '18000000');
    await dragTo(page, plate, 'COMPRADO');
    await expect(
      page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible({ timeout: 10_000 });

    await dragTo(page, plate, 'ALISTAMIENTO');

    // Nueva UX: en vez de la alerta, se abre el formulario para completar los campos faltantes.
    await expect(page.getByTestId('vehicle-form-submit')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Cancelar/ }).click();

    // Al cancelar sin completar, la card sigue en COMPRADO.
    await expect(
      page.getByTestId('kanban-column-COMPRADO').getByTestId(`vehicle-card-${plate}`),
    ).toBeVisible();
    await expect(
      page.getByTestId('kanban-column-ALISTAMIENTO').getByTestId(`vehicle-card-${plate}`),
    ).toHaveCount(0);
  });
});
