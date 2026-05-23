import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle } from '../../helpers/api';

// Sube un PDF por la UI (drag-and-drop) y deja la lista de documentos cargada.
async function uploadPdf(page: import('@playwright/test').Page, vehicleId: string, name = 'doc.pdf') {
  await page.goto(`/vehicles/${vehicleId}?tab=documentos`);
  await page.getByTestId('open-document-form').click();
  const dropzone = page.getByTestId('document-dropzone');
  const dataTransfer = await page.evaluateHandle((fname) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], fname, { type: 'application/pdf' }));
    return dt;
  }, name);
  await dropzone.dispatchEvent('drop', { dataTransfer });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/documents/vehicle/') && r.request().method() === 'POST'),
    page.getByTestId('document-save').click(),
  ]);
}

test.describe('Documentos — ver y eliminar', () => {
  test('ver un documento abre el visor con opción de descarga', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `DOV${Date.now().toString().slice(-7)}` });
    await uploadPdf(page, vehicle.id);

    await expect(page.getByTestId('document-card')).toHaveCount(1);
    await page.getByTestId('document-view').click();
    await expect(page.getByTestId('document-download')).toBeVisible();
  });

  test('eliminar pide confirmación en línea antes de borrar', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `DOD${Date.now().toString().slice(-7)}` });
    await uploadPdf(page, vehicle.id);

    await expect(page.getByTestId('document-card')).toHaveCount(1);

    // El primer click NO borra: pide confirmación y el documento sigue ahí.
    await page.getByTestId('document-delete').click();
    await expect(page.getByTestId('document-delete-confirm')).toBeVisible();
    await expect(page.getByTestId('document-card')).toHaveCount(1);

    // Confirmar sí borra.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/documents/') && r.request().method() === 'DELETE'),
      page.getByTestId('document-delete-confirm').click(),
    ]);
    await expect(page.getByTestId('document-card')).toHaveCount(0);
  });
});
