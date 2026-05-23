import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle } from '../../helpers/api';

// Feature: subir documentos arrastrando y soltando en la zona de subida.
test.describe('Documentos — arrastrar y soltar', () => {
  test('soltar un archivo en la zona lo selecciona y se sube', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `DOC${Date.now().toString().slice(-7)}` });

    await page.goto(`/vehicles/${vehicle.id}?tab=documentos`);
    await page.getByTestId('open-document-form').click();

    const dropzone = page.getByTestId('document-dropzone');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toContainText('Arrastra un archivo');

    // Simular el drop de un archivo (patrón soportado por Playwright vía DataTransfer).
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'tarjeta.pdf', { type: 'application/pdf' });
      dt.items.add(file);
      return dt;
    });
    await dropzone.dispatchEvent('drop', { dataTransfer });

    // El archivo soltado quedó seleccionado en la zona.
    await expect(dropzone).toContainText('tarjeta.pdf');

    // Guardar dispara la subida real al backend.
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/documents/vehicle/') && r.request().method() === 'POST',
        { timeout: 10_000 },
      ),
      page.getByTestId('document-save').click(),
    ]);
    expect(resp.ok()).toBeTruthy();
  });

  test('soltar un archivo de tipo no permitido muestra error y no lo selecciona', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `DOC${Date.now().toString().slice(-7)}` });

    await page.goto(`/vehicles/${vehicle.id}?tab=documentos`);
    await page.getByTestId('open-document-form').click();

    const dropzone = page.getByTestId('document-dropzone');
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(['x'], 'malicioso.exe', { type: 'application/x-msdownload' });
      dt.items.add(file);
      return dt;
    });
    await dropzone.dispatchEvent('drop', { dataTransfer });

    await expect(page.getByText('Formato no permitido')).toBeVisible();
    await expect(page.getByTestId('document-save')).toBeDisabled();
  });
});
