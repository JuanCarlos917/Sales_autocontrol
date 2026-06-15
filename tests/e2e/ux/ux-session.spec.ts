import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiRequestRaw, apiCreateUser, apiMe } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const uniq = () => `u${Date.now().toString().slice(-7)}@test.co`;

test.describe('UX y sesión', () => {
  test.afterEach(async () => { await setUserRole(ADMIN_EMAIL, 'ADMIN'); });

  test('login no muestra pista de credenciales', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/PIN por defecto/i)).toHaveCount(0);
  });

  test('Settings con tabs: ADMIN ve Usuarios; no-ADMIN no', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-tabs')).toBeVisible();
    await expect(page.getByTestId('settings-tab-usuarios')).toBeVisible();
    // cambiar a la tab Usuarios muestra la card de usuarios
    await page.getByTestId('settings-tab-usuarios').click();
    await expect(page.getByTestId('settings-users-card')).toBeVisible();

    // como no-ADMIN, la tab Usuarios desaparece
    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    await page.reload();
    await expect(page.getByTestId('settings-tab-negocio')).toBeVisible();
    await expect(page.getByTestId('settings-tab-usuarios')).toHaveCount(0);
  });

  test('VIEWER no ve controles de escritura', async ({ page }) => {
    await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'VIEWER');

    await page.goto('/expenses');
    await expect(page.getByTestId('expenses-create-button')).toHaveCount(0);

    await page.goto('/treasury/loans');
    await expect(page.getByTestId('loans-create-button')).toHaveCount(0);

    await page.goto('/treasury/debts');
    await expect(page.getByTestId('debts-create-button')).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByTestId('kanban-create-vehicle')).toHaveCount(0);
    await expect(page.getByTestId('viewer-readonly-badge')).toBeVisible({ timeout: 10_000 });
  });

  test('inactividad: avisa y cierra sesión', async ({ page }) => {
    // Umbrales chicos solo para este test (override de dev en el hook).
    await page.addInitScript(() => {
      window.__IDLE_LIMIT_MS__ = 4000;
      window.__IDLE_WARN_MS__ = 2000;
    });
    await loginAsAdmin(page);
    await page.goto('/dashboard');

    // Aparece el aviso (~2s) y luego cierra sesión → vuelve a /login (~4s)
    await expect(page.getByTestId('idle-warning-modal')).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });

  test('sesiones de usuarios distintos son independientes', async ({ page }) => {
    const adminToken = await loginAsAdmin(page);
    const email = uniq();
    await apiCreateUser(adminToken, { email, password: 'Pass12345', role: 'SUPERVISOR' });
    const otherToken = (await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).body as { accessToken?: string };
    const bToken = otherToken.accessToken as string;

    // Ambos tokens siguen válidos y devuelven su propio usuario
    expect((await apiMe(adminToken)).user.email).toBe(ADMIN_EMAIL);
    expect((await apiMe(bToken)).user.email).toBe(email);
    // operar con uno no invalida al otro
    expect((await apiRequestRaw('GET', '/vehicles', bToken)).status).toBe(200);
    expect((await apiMe(adminToken)).user.email).toBe(ADMIN_EMAIL);
  });
});
