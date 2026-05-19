import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateVehicle,
  apiCreateExpense,
  apiUpdateExpense,
  apiDeleteExpense,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';
import { forceVehicleStage } from '../../helpers/db';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';

test.describe('Gastos — VENDIDO lock', () => {
  test('vehículo VENDIDO bloquea create / update / delete del gasto + delete del vehículo', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `LCK${Date.now().toString().slice(-7)}` });

    // Crear un gasto antes de marcar como vendido
    const { expense } = await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountCash,
      category: 'MECANICA',
      amount: 200_000,
      isPaid: true,
    });

    // Forzar el vehículo a VENDIDO bypassing validaciones
    await forceVehicleStage(vehicle.id, 'VENDIDO');

    // CREATE gasto en vehículo VENDIDO → 403
    {
      let error: Error | null = null;
      try {
        await apiCreateExpense(token, {
          vehicleId: vehicle.id,
          accountId: TEST_SEED_IDS.accountCash,
          category: 'OTRO',
          amount: 10_000,
          isPaid: true,
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).toMatch(/403|VENDIDO/i);
    }

    // UPDATE gasto en vehículo VENDIDO → 403
    {
      let error: Error | null = null;
      try {
        await apiUpdateExpense(token, expense.id, { description: 'cambio' });
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).toMatch(/403|VENDIDO/i);
    }

    // DELETE gasto en vehículo VENDIDO → 403
    {
      let error: Error | null = null;
      try {
        await apiDeleteExpense(token, expense.id, 'Motivo cualquiera para test');
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).toMatch(/403|VENDIDO/i);
    }

    // DELETE vehículo VENDIDO → 403
    const delVehicle = await page.request.delete(`${API_BASE}/vehicles/${vehicle.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delVehicle.status()).toBe(403);
  });

  test('mover vehículo de VENDIDO a otra etapa devuelve 403 (one-way)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const vehicle = await apiCreateVehicle(token, { plate: `OWY${Date.now().toString().slice(-7)}` });
    await forceVehicleStage(vehicle.id, 'VENDIDO');

    const res = await page.request.patch(`${API_BASE}/vehicles/${vehicle.id}/stage`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { stage: 'DISPONIBLE' },
    });
    expect(res.status()).toBe(403);
  });
});
