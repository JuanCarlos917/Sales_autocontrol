import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiRegisterSale,
  apiUpdateCommissionConfig,
  apiListInvestors,
  apiGetInvestorsSummary,
  apiGetPayablesSummary,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

// Campos legacy que el schema Joi de PUT /settings/commission-config sigue
// exigiendo como `required()` aunque la cascada actual (Task 2) ya no los lea
// para calcular montos — mismo patrón que commission-split-team.spec.ts.
const BASE_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

async function setInvestorTeam(
  token: string,
  team: Array<{ thirdPartyId: string; sharePct: number }>,
): Promise<void> {
  const res = await apiUpdateCommissionConfig(token, { ...BASE_CFG, investor_team: team });
  expect(res.status).toBe(200);
}

async function createThirdParty(token: string, name: string): Promise<string> {
  const res = await apiRequestRaw('POST', '/treasury/third-parties', token, {
    name, type: 'EMPLOYEE',
  });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

/**
 * Vende un vehículo cash 30M − costo 20M (ganancia bruta 10M) con vendedores
 * explícitos captador/cerrador sumando 100. Devuelve el vehículo + el summary
 * de la venta con la cascada completa.
 */
async function sellCarWithSellers(token: string, plateStr: string) {
  const v = await apiCreateVehicle(token, {
    plate: plateStr,
    stage: 'COMPRADO',
    negotiatedValue: 20_000_000,
    purchasePrice: 20_000_000,
    listedPrice: 30_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  const sale = await apiRegisterSale(token, v.id, {
    salePrice: 30_000_000,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    participants: [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
      { thirdPartyId: TEST_SEED_IDS.partner, role: 'CERRADOR', sharePct: 70 },
    ],
  });
  return { vehicle: v, sale };
}

test.describe('Ganancia — inversionistas (flujo venta → reparto → pago)', () => {
  // La tabla settings NO se trunca entre tests (solo STATE_TABLES vía
  // resetStatePerTest): este spec muta investor_team y DEBE restaurarlo para
  // no contaminar commissions.spec.ts (asume fallback owner-self 100% sin
  // investor_team configurado).
  test.afterEach(async () => {
    const token = await apiPinLogin();
    await setInvestorTeam(token, []);
  });

  test('venta con investor_team de 2 personas: investors suman profitToDistribute y sellers la comisión', async () => {
    const token = await apiPinLogin();
    const invA = await createThirdParty(token, `Inversionista A ${Date.now()}`);
    const invB = await createThirdParty(token, `Inversionista B ${Date.now()}`);
    await setInvestorTeam(token, [
      { thirdPartyId: invA, sharePct: 60 },
      { thirdPartyId: invB, sharePct: 40 },
    ]);

    const { sale } = await sellCarWithSellers(token, plate('INV'));

    // Cascada: gross 10M → pool comisión 10% = 1M (vendedores) → neto 9M →
    // reinvest 30% = 2.7M, tax 10% = 0.9M → profitToDistribute = 5.4M.
    expect(sale.summary.grossProfit).toBe(10_000_000);
    expect(sale.summary.commissionPool).toBe(1_000_000);
    expect(sale.summary.reinvestAmount).toBe(2_700_000);
    expect(sale.summary.taxAmount).toBe(900_000);
    expect(sale.summary.profitToDistribute).toBe(5_400_000);

    // Sellers: captador 30% de 1M = 300k, cerrador 70% = 700k
    expect(sale.summary.sellers).toHaveLength(2);
    const captador = sale.summary.sellers!.find((p) => p.role === 'CAPTADOR');
    const cerrador = sale.summary.sellers!.find((p) => p.role === 'CERRADOR');
    expect(captador?.amount).toBe(300_000);
    expect(cerrador?.amount).toBe(700_000);

    // Investors: invA 60% de 5.4M = 3.24M, invB 40% = 2.16M, suman profitToDistribute
    expect(sale.summary.investors).toHaveLength(2);
    const a = sale.summary.investors!.find((p) => p.thirdPartyId === invA);
    const b = sale.summary.investors!.find((p) => p.thirdPartyId === invB);
    expect(a?.amount).toBe(3_240_000);
    expect(b?.amount).toBe(2_160_000);
    const investorsSum = sale.summary.investors!.reduce((s, p) => s + p.amount, 0);
    expect(investorsSum).toBe(sale.summary.profitToDistribute);

    // GET /investors expone la cascada de GANANCIA real (buildInvestorVehicleItem),
    // NO la base de comisión (commissionBase/participation) — Findings #3.
    const items = await apiListInvestors(token);
    const item = items.find((i) => i.vehicle.plate === sale.vehicle.plate);
    expect(item).toBeTruthy();
    expect(item!.cascade.salePrice).toBe(30_000_000);
    expect(item!.cascade.purchaseCost).toBe(20_000_000);
    expect(item!.cascade.grossProfit).toBe(10_000_000);
    expect(item!.cascade.commissionPool).toBe(1_000_000);
    expect(item!.cascade.reinvest).toBe(2_700_000);
    expect(item!.cascade.tax).toBe(900_000);
    expect(item!.cascade.profitToDistribute).toBe(5_400_000);
    // Invariante de la cascada: gross − comisión − reinversión − impuestos = a repartir.
    expect(
      item!.cascade.grossProfit - item!.cascade.commissionPool - item!.cascade.reinvest - item!.cascade.tax,
    ).toBe(item!.cascade.profitToDistribute);
    // El item de comisión (base) NO se mezcla en el de inversionistas.
    expect((item!.cascade as unknown as { commissionBase?: number }).commissionBase).toBeUndefined();
  });

  test('GET /investors/summary refleja la ganancia pendiente por persona', async () => {
    const token = await apiPinLogin();
    const invA = await createThirdParty(token, `Inversionista Sum A ${Date.now()}`);
    const invB = await createThirdParty(token, `Inversionista Sum B ${Date.now()}`);
    await setInvestorTeam(token, [
      { thirdPartyId: invA, sharePct: 60 },
      { thirdPartyId: invB, sharePct: 40 },
    ]);

    // Finding #2 (verificación e2e): GET /payables/summary debe INCLUIR la CxP
    // PROFIT_SHARE pendiente en payables.total (payableService.getSummary agrega
    // PAYABLE + COMMISSION + PROFIT_SHARE) — snapshot antes de vender.
    const beforeSummary = await apiGetPayablesSummary(token);

    await sellCarWithSellers(token, plate('SUM'));

    const summary = await apiGetInvestorsSummary(token);
    const personA = summary.byPerson.find((p) => p.thirdParty.id === invA);
    const personB = summary.byPerson.find((p) => p.thirdParty.id === invB);
    expect(personA?.totalPending).toBe(3_240_000);
    expect(personA?.salesCount).toBe(1);
    expect(personB?.totalPending).toBe(2_160_000);
    expect(personB?.salesCount).toBe(1);
    expect(summary.pendingTotal).toBeGreaterThanOrEqual(5_400_000);

    // La venta también generó CxP COMMISSION (1M, vendedores) además de la
    // PROFIT_SHARE (5.4M, inversionistas): payables.total sube por AL MENOS
    // la ganancia pendiente de los inversionistas.
    const afterSummary = await apiGetPayablesSummary(token);
    expect(afterSummary.payables.total).toBeGreaterThanOrEqual(
      beforeSummary.payables.total + 5_400_000,
    );
  });

  test('pagar la CxP PROFIT_SHARE de un inversionista baja el pendiente', async () => {
    const token = await apiPinLogin();
    const invA = await createThirdParty(token, `Inversionista Pago A ${Date.now()}`);
    const invB = await createThirdParty(token, `Inversionista Pago B ${Date.now()}`);
    await setInvestorTeam(token, [
      { thirdPartyId: invA, sharePct: 60 },
      { thirdPartyId: invB, sharePct: 40 },
    ]);

    const { sale } = await sellCarWithSellers(token, plate('PAY'));
    const payableA = sale.summary.investors!.find((p) => p.thirdPartyId === invA)!;
    expect(payableA).toBeDefined();

    const before = await apiGetInvestorsSummary(token);
    const beforeA = before.byPerson.find((p) => p.thirdParty.id === invA);
    expect(beforeA?.totalPending).toBe(3_240_000);

    const pay = await apiRequestRaw('POST', `/payables/${payableA.payableId}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: payableA.amount,
      description: 'Pago ganancia inversionista A',
    });
    expect(pay.status).toBe(201);

    // Finding #1 (verificación e2e): la Transaction creada al pagar una CxP
    // PROFIT_SHARE debe categorizarse como 'PROFIT_SHARE', NO 'VEHICLE_PURCHASE'
    // (payableService.addPayment) — contaminaría el costo del vehículo.
    const payBody = pay.body as { transaction?: { category?: string; type?: string } };
    expect(payBody.transaction?.category).toBe('PROFIT_SHARE');
    expect(payBody.transaction?.type).toBe('EXPENSE');

    const after = await apiGetInvestorsSummary(token);
    const afterA = after.byPerson.find((p) => p.thirdParty.id === invA);
    expect(afterA?.totalPending).toBe(0);
    expect(afterA?.totalPaid).toBe(3_240_000);

    // invB sigue pendiente: el pago de A no lo afecta
    const afterB = after.byPerson.find((p) => p.thirdParty.id === invB);
    expect(afterB?.totalPending).toBe(2_160_000);

    // El listado por vehículo refleja el rol INVESTOR de A como PAID
    const items = await apiListInvestors(token);
    const item = items.find((i) => i.vehicle.plate === sale.vehicle.plate);
    expect(item).toBeTruthy();
    const roleA = item!.roles.find((r) => r.thirdParty.id === invA);
    expect(roleA?.status).toBe('PAID');
    expect(roleA?.pending).toBe(0);
  });

  test('InvestorsPage muestra la card del vehículo, el pendiente por persona y permite pagar', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const invA = await createThirdParty(token, `Inversionista UI A ${Date.now()}`);
    const invB = await createThirdParty(token, `Inversionista UI B ${Date.now()}`);

    // Dos ventas, cada una con UN solo inversionista (100%): el testid de rol
    // (`investor-role-{plate}-INVESTOR`) no distingue por persona cuando hay
    // varios inversionistas en el mismo carro, así que para el pago
    // determinista por UI usamos 1 inversionista por card; la distribución
    // multi-persona ya está cubierta en los tests de API arriba.
    await setInvestorTeam(token, [{ thirdPartyId: invA, sharePct: 100 }]);
    const p1 = plate('UIA');
    await sellCarWithSellers(token, p1);

    await setInvestorTeam(token, [{ thirdPartyId: invB, sharePct: 100 }]);
    const p2 = plate('UIB');
    await sellCarWithSellers(token, p2);

    await page.goto('/treasury/investors');
    await expect(page.getByTestId('investors-page')).toBeVisible();

    const card1 = page.getByTestId(`investor-card-${p1}`);
    await expect(card1).toBeVisible({ timeout: 10_000 });
    await expect(card1).toContainText('10.000.000'); // grossProfit determinista del escenario
    // Cascada de GANANCIA real (Finding #3): labels correctos, sin "base de
    // comisión" ni "% participación" mezclados en la vista de inversionistas.
    await expect(card1).toContainText('Ganancia bruta');
    await expect(card1).toContainText('Comisión');
    await expect(card1).toContainText('Reinversión');
    await expect(card1).toContainText('Impuestos');
    await expect(card1).toContainText('Ganancia a repartir');
    await expect(card1).not.toContainText('Base de reparto');

    const card2 = page.getByTestId(`investor-card-${p2}`);
    await expect(card2).toBeVisible();

    // KPI de pendiente > 0 antes de pagar
    await expect(page.getByTestId('investors-kpi-pending')).not.toContainText('$0');

    // Por persona: ambos inversionistas aparecen con su pendiente (uno por venta)
    await expect(page.getByTestId('investors-by-person')).toBeVisible();
    await expect(page.getByTestId(`investors-person-${invA}`)).toBeVisible();
    await expect(page.getByTestId(`investors-person-${invB}`)).toBeVisible();

    // Pagar el rol INVESTOR de la primera card (único en esa card → testid sin ambigüedad)
    await expect(page.getByTestId(`investor-role-status-${p1}-INVESTOR`)).toContainText('Pendiente');
    await page.getByTestId(`investor-pay-${p1}-INVESTOR`).click();
    await page.getByTestId('payment-modal-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('payment-modal-submit').click();

    // Al quedar 100% pagada, la card de p1 pasa a la sección "Pagadas" (colapsada
    // por defecto, no se renderiza en el DOM hasta expandirla) — verificamos el
    // resultado por la fila "Por persona", que sí sigue visible sin expandir nada.
    await expect(page.getByTestId(`investors-person-${invA}`)).toContainText('0 pendiente', { timeout: 10_000 });
    await expect(page.getByTestId(`investors-person-${invA}`)).toContainText('5.400.000 pagado');
    // La segunda venta (inversionista B) sigue pendiente, sin verse afectada
    await expect(page.getByTestId(`investor-role-status-${p2}-INVESTOR`)).toContainText('Pendiente');
    await expect(page.getByTestId(`investors-person-${invB}`)).toContainText('5.400.000 pendiente');
  });
});
