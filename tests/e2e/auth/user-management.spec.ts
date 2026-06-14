import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiRequestRaw, apiCreateUser, apiMe } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const uniq = () => `u${Date.now().toString().slice(-7)}@test.co`;
const tokenOf = (res: { body: { error?: string } | null }) =>
  (res.body as { accessToken?: string } | null)?.accessToken as string;

test.describe('Gestión de usuarios (admin-only)', () => {
  test.afterEach(async () => { await setUserRole(ADMIN_EMAIL, 'ADMIN'); });

  test('ADMIN crea un VIEWER: puede leer, no escribir; reset y desactivar', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const email = uniq();

    const created = await apiCreateUser(token, { email, password: 'Pass12345', role: 'VIEWER', pin: '123456' });
    expect(created.role).toBe('VIEWER');
    expect(created.isActive).toBe(true);

    // login del nuevo usuario y permisos
    const login = await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' });
    expect(login.status).toBe(200);
    const vToken = tokenOf(login);
    expect((await apiRequestRaw('GET', '/vehicles', vToken)).status).toBe(200);
    expect((await apiRequestRaw('POST', '/vehicles', vToken, { plate: 'NOPE01' })).status).toBe(403);

    // reset de contraseña: nueva sí, vieja no
    expect((await apiRequestRaw('PATCH', `/users/${created.id}/password`, token, { password: 'Nueva99999' })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Nueva99999' })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).status).toBe(401);

    // desactivar → no puede loguear
    expect((await apiRequestRaw('PATCH', `/users/${created.id}/status`, token, { isActive: false })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Nueva99999' })).status).toBe(401);

    // borrar usuario sin actividad → ok
    expect((await apiRequestRaw('DELETE', `/users/${created.id}`, token)).status).toBe(200);
  });

  test('no-ADMIN no puede acceder a /users (403)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR'); // authenticate re-lee el rol de la DB por request
    expect((await apiRequestRaw('GET', '/users', token)).status).toBe(403);
    expect((await apiRequestRaw('POST', '/users', token, { email: uniq(), password: 'Pass12345', role: 'VIEWER' })).status).toBe(403);
  });

  test('salvaguardas: auto-acción bloqueada (último ADMIN)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const me = (await apiMe(token)).user;

    expect((await apiRequestRaw('PATCH', `/users/${me.id}/role`, token, { role: 'VIEWER' })).status).toBe(403);
    expect((await apiRequestRaw('PATCH', `/users/${me.id}/status`, token, { isActive: false })).status).toBe(403);
    expect((await apiRequestRaw('DELETE', `/users/${me.id}`, token)).status).toBe(403);
  });

  test('borrar un usuario CON actividad → 409 (sugiere desactivar)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const email = uniq();
    const sup = await apiCreateUser(token, { email, password: 'Pass12345', role: 'SUPERVISOR' });

    // El SUPERVISOR crea un vehículo (genera actividad/datos asociados)
    const supToken = tokenOf(await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' }));
    expect((await apiRequestRaw('POST', '/vehicles', supToken, { plate: `ACT${Date.now().toString().slice(-6)}` })).status).toBe(201);

    // Borrarlo ahora debe bloquearse con 409
    expect((await apiRequestRaw('DELETE', `/users/${sup.id}`, token)).status).toBe(409);

    // Desactivarlo sí funciona (alternativa segura)
    expect((await apiRequestRaw('PATCH', `/users/${sup.id}/status`, token, { isActive: false })).status).toBe(200);
  });

  test('el registro público quedó cerrado (no se puede registrar)', async ({ page }) => {
    await loginAsAdmin(page);
    // Ruta eliminada: sin token el authenticate global responde 401; con token no hay ruta (404).
    // En cualquier caso, registrarse públicamente es imposible (nunca 200/201).
    const res = await apiRequestRaw('POST', '/auth/register', '', { email: uniq(), password: 'Pass12345' });
    expect([401, 404]).toContain(res.status);
  });
});
