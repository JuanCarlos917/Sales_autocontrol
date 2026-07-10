import { test, expect } from '../../fixtures/test';
import { apiPinLogin, apiRequestRaw } from '../../helpers/api';

// Gap detectado al montar el equipo para comisiones: el enum de DB tiene
// EMPLOYEE (y el motor de comisiones lo usa via 'owner-self'), pero el Joi de
// terceros no lo aceptaba → no se podía registrar al equipo ni editar
// 'owner-self' sin pisarle el tipo.

test.describe('Terceros — tipo Empleado', () => {
  test('crear un tercero tipo EMPLOYEE devuelve 201', async () => {
    const token = await apiPinLogin();
    const res = await apiRequestRaw('POST', '/treasury/third-parties', token, {
      name: `Empleado Test ${Date.now()}`,
      type: 'EMPLOYEE',
      phone: '3001234567',
    });
    expect(res.status).toBe(201);
    expect((res.body as { type?: string }).type).toBe('EMPLOYEE');
  });

  test('editar owner-self conserva el tipo EMPLOYEE', async () => {
    const token = await apiPinLogin();
    const res = await apiRequestRaw('PUT', '/treasury/third-parties/owner-self', token, {
      name: 'Juan (dueño)',
      type: 'EMPLOYEE',
    });
    expect(res.status).toBe(200);
    expect((res.body as { type?: string }).type).toBe('EMPLOYEE');
  });
});
