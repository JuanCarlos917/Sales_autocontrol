import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateAccount, apiReverseAccountRaw } from '../../helpers/api';

test.describe('Cuentas — desactivación desde la UI', () => {
  test('admin desactiva una cuenta en cero: desaparece de la vista y el toggle "Mostrar inactivas" la revela', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const account = await apiCreateAccount(token, {
      name: `Cuenta UI desactivar ${Date.now()}`,
      type: 'CASH',
      initialBalance: 0,
    });

    await page.goto('/treasury/accounts');
    await expect(page.getByTestId(`account-card-${account.id}`)).toBeVisible();

    await page.getByTestId(`account-${account.id}-reverse-btn`).click();
    await expect(page.getByTestId(`account-${account.id}-reverse-modal`)).toBeVisible();

    const confirm = page.getByTestId(`account-${account.id}-reverse-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`account-${account.id}-reverse-reason`).fill('cuenta creada por error');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Por defecto las cuentas inactivas no se muestran: la tarjeta desaparece.
    await expect(page.getByTestId(`account-card-${account.id}`)).toHaveCount(0, { timeout: 10_000 });

    // El toggle "Mostrar inactivas" la revela, con badge Inactiva y sin botón de desactivar.
    await page.getByTestId('toggle-show-inactive').click();
    await expect(page.getByTestId(`account-card-${account.id}`)).toBeVisible();
    await expect(page.getByTestId(`account-${account.id}-inactive`)).toBeVisible();
    await expect(page.getByTestId(`account-${account.id}-reverse-btn`)).toHaveCount(0);
  });

  test('admin reactiva una cuenta inactiva con el botón Activar', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const account = await apiCreateAccount(token, {
      name: `Cuenta UI activar ${Date.now()}`,
      type: 'CASH',
      initialBalance: 0,
    });
    await apiReverseAccountRaw(token, account.id, 'desactivada para probar reactivación');

    await page.goto('/treasury/accounts');
    // Inactiva → oculta por defecto; el toggle la revela con el botón Activar.
    await expect(page.getByTestId(`account-card-${account.id}`)).toHaveCount(0);
    await page.getByTestId('toggle-show-inactive').click();
    await expect(page.getByTestId(`account-${account.id}-inactive`)).toBeVisible();

    // Activar (confirm() → aceptar) → vuelve a estar activa: sin badge y con el
    // botón de desactivar de nuevo disponible.
    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`account-${account.id}-activate`).click();
    await expect(page.getByTestId(`account-${account.id}-inactive`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`account-${account.id}-reverse-btn`)).toBeVisible();
  });

  test('bloquea la desactivación de una cuenta con saldo y muestra el error', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const account = await apiCreateAccount(token, {
      name: `Cuenta UI con saldo ${Date.now()}`,
      type: 'CASH',
      initialBalance: 1_000_000,
    });

    await page.goto('/treasury/accounts');
    await page.getByTestId(`account-${account.id}-reverse-btn`).click();
    await page.getByTestId(`account-${account.id}-reverse-reason`).fill('intento de desactivar con saldo');
    await page.getByTestId(`account-${account.id}-reverse-confirm`).click();

    // El backend responde 403 (saldo≠0 o con movimientos); el modal se mantiene abierto con el error.
    await expect(page.getByTestId(`account-${account.id}-reverse-error`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`account-${account.id}-inactive`)).toHaveCount(0);
  });
});
