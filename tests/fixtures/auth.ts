import { Page, expect } from '@playwright/test';

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

export async function loginAsAdmin(page: Page): Promise<string> {
  await page.goto('/login');
  await page.locator('input[maxlength="6"]').fill(ADMIN_PIN);
  await page.getByRole('button', { name: /Ingresar/ }).click();
  await page.waitForURL('**/', { timeout: 10_000 });
  await expect(page.getByText('NEGOCIANDO').first()).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('accessToken'));
  if (!token) throw new Error('accessToken not found in localStorage after login');
  return token;
}
