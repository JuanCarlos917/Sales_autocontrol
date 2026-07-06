import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateAccount } from '../../helpers/api';

test.describe('Cuentas — desactivación desde la UI', () => {
  test('admin desactiva una cuenta en cero y aparece el badge Inactiva', async ({ page }) => {
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

    await expect(page.getByTestId(`account-${account.id}-inactive`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`account-${account.id}-reverse-btn`)).toHaveCount(0);
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
