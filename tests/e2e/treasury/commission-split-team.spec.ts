import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiRegisterSale,
  apiUpdateCommissionConfig,
  apiListCommissions,
  apiGetCommissionsSummary,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

const BASE_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

async function setTeam(token: string, team: Array<{ thirdPartyId: string; role: string; sharePct: number }>) {
  const res = await apiUpdateCommissionConfig(token, { ...BASE_CFG, commission_default_team: team });
  expect(res.status).toBe(200);
}

async function sellCar(token: string, participants?: Array<{ thirdPartyId: string; role: string; sharePct: number }>) {
  const v = await apiCreateVehicle(token, {
    plate: plate('TEA'),
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  await apiRegisterSale(token, v.id, {
    salePrice: 40_000_000,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 40_000_000 },
    ...(participants ? { participants } : {}),
  });
  return v;
}

test.describe('Comisiones — equipo de reparto + métricas', () => {
  // La tabla settings NO se trunca entre tests: este spec muta el equipo
  // default global y DEBE restaurarlo para no contaminar otros specs
  // (commissions-page.spec asume el fallback legacy sin equipo).
  test.afterEach(async () => {
    const token = await apiPinLogin();
    await setTeam(token, []);
  });

  test('venta sin tocar aplica el equipo default y el dueño recibe el resto', async () => {
    const token = await apiPinLogin();
    await setTeam(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
      { thirdPartyId: TEST_SEED_IDS.partner, role: 'OTHER', sharePct: 15 },
    ]);
    const v = await sellCar(token);

    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === v.plate)!;
    expect(item.roles.length).toBe(3); // empleado + partner + dueño (resto 55%)
    const owner = item.roles.find((r) => r.thirdParty.id === 'owner-self')!;
    expect(owner.sharePct).toBe(55);
    // bolsillo 60% de 10M = 6M; dueño 55% de 6M = 3.3M
    expect(owner.total).toBe(3_300_000);
  });

  test('reparto que suma 100 no genera fila del dueño; >5 personas es 400', async () => {
    const token = await apiPinLogin();
    await setTeam(token, []); // sin equipo para aislar
    const v = await sellCar(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 60 },
      { thirdPartyId: TEST_SEED_IDS.partner, role: 'CERRADOR', sharePct: 40 },
    ]);
    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === v.plate)!;
    expect(item.roles.length).toBe(2);
    expect(item.roles.some((r) => r.thirdParty.id === 'owner-self')).toBe(false);

    // 6 personas → 400 (crear 6 terceros temporales)
    const six = [];
    for (let i = 0; i < 6; i++) {
      const created = await apiRequestRaw('POST', '/treasury/third-parties', token, {
        name: `Split6 ${Date.now()}-${i}`, type: 'EMPLOYEE',
      });
      six.push({ thirdPartyId: (created.body as { id: string }).id, role: 'OTHER', sharePct: 10 });
    }
    const veh = await apiCreateVehicle(token, {
      plate: plate('SIX'), stage: 'COMPRADO', negotiatedValue: 10_000_000,
      purchasePrice: 10_000_000, listedPrice: 12_000_000, supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRequestRaw('POST', `/vehicles/${veh.id}/sell`, token, {
      salePrice: 12_000_000, paymentType: 'CASH', buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000 },
      participants: six,
    });
    expect(res.status).toBe(400);
  });

  test('summary por persona + dashboard card navega a comisiones', async ({ page }) => {
    const token = await loginAsAdmin(page);
    await setTeam(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
    ]);
    await sellCar(token);

    const summary = await apiGetCommissionsSummary(token);
    const emp = summary.byPerson.find((p) => p.thirdParty.id === TEST_SEED_IDS.employee)!;
    expect(emp.totalPending).toBeGreaterThan(0);
    expect(emp.salesCount).toBe(1);
    expect(summary.pendingTotal).toBeGreaterThan(0);

    // Dashboard: card visible y navega
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-commissions-card');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/treasury\/commissions/);
    await expect(page.getByTestId('commissions-by-person')).toBeVisible();
    await expect(page.getByTestId(`commissions-person-${TEST_SEED_IDS.employee}`)).toBeVisible();
  });
});
