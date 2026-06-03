import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiGetVehicle, apiRequestRaw } from '../../helpers/api';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

// Regresión del bug de producción (FJT326): el usuario llenó los campos de "vehículo
// recibido en cruce" usando el formulario de Editar (PUT /vehicles/:id) en lugar del
// modal de venta. El PUT aceptaba esos campos, los grababa en el vehículo y NO creaba
// el vehículo en NEGOCIANDO ni la CxC por la diferencia. El cruce solo puede registrarse
// vía POST /vehicles/:id/sell con tradeIn.
test.describe('Vehículos — el PUT debe ignorar los campos de cruce', () => {
  test('PUT con receivedVehicle/receivedVehiclePlate/receivedVehicleValue no debe persistir esos campos', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // Veh en NEGOCIANDO: una etapa donde el resto de validaciones de stage NO disparan.
    // Aislamos así el contrato del PUT respecto a los campos del cruce.
    const v = await apiCreateVehicle(token, {
      plate: plate('TIP'),
      brand: 'Chevrolet',
      negotiatedValue: 20_000_000,
    });

    // Intentar inyectar datos de cruce vía PUT (simula el form de Editar antes del fix).
    const res = await apiRequestRaw('PUT', `/vehicles/${v.id}`, token, {
      receivedVehicle: true,
      receivedVehiclePlate: 'CRX999',
      receivedVehicleValue: 17_500_000,
      notes: 'intento de inyectar cruce por PUT',
    });

    // El backend puede aceptarlo (200) o rechazarlo (400). Lo crítico es que los
    // campos del cruce NUNCA queden persistidos en el vehículo a través de este path.
    // El único camino válido para grabarlos es POST /vehicles/:id/sell con tradeIn.
    expect([200, 400]).toContain(res.status);

    const after = await apiGetVehicle(token, v.id);
    expect(after.receivedVehicle).toBe(false);
    expect(after.receivedVehiclePlate).toBeNull();
    expect(after.receivedVehicleValue).toBeNull();
  });
});
