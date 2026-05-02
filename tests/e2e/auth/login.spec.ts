import { test, expect } from '@playwright/test';

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

test.describe('Auth — login con PIN', () => {
  test('login con PIN válido redirige al Kanban', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'AutoControl' })).toBeVisible();

    const pinInput = page.locator('input[maxlength="6"]');
    await expect(pinInput).toBeVisible();
    await pinInput.fill(ADMIN_PIN);

    await page.getByRole('button', { name: /Ingresar/ }).click();

    await page.waitForURL('**/', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/');

    await expect(page.getByText('NEGOCIANDO').first()).toBeVisible();
  });

  test('login con PIN inválido muestra error y permanece en /login', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input[maxlength="6"]').fill('0000');
    await page.getByRole('button', { name: /Ingresar/ }).click();

    await expect(page.getByText(/Error|inválid|incorrect/i)).toBeVisible({ timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe('/login');
  });
});
