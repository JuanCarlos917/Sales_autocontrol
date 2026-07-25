import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiRequestRaw,
  apiCreateVehicle,
  apiConfirmPurchase,
  apiMoveStage,
  apiRegisterSale,
  apiListPayables,
  apiListAccounts,
  apiUpdateCommissionConfig,
  apiListCommissions,
  type Account,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Campos legacy que el schema Joi de PUT /settings/commission-config sigue
// exigiendo como `required()` — mismo patrón que cuentas-socio.spec / investors.spec.
const BASE_COMMISSION_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

// Tipos de CxP que marcan que un vehículo (o negocio) YA distribuyó su venta —
// CAPITAL_RETURN queda fuera a propósito (devolución de capital, no distribución).
const DISTRIBUTION_TYPES = ['COMMISSION', 'COMMISSION_RETURN', 'PROFIT_SHARE', 'PARTNER_SHARE'];

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
}

async function createThirdParty(
  token: string,
  data: { name: string; type: string },
): Promise<{ id: string; name: string; type: string }> {
  const res = await apiRequestRaw('POST', '/treasury/third-parties', token, data);
  expect(res.status).toBe(201);
  return res.body as unknown as { id: string; name: string; type: string };
}

async function findSocioAccount(token: string, thirdPartyId: string): Promise<Account | undefined> {
  const accounts = await apiListAccounts(token);
  return accounts.find((a) => a.type === 'SOCIO' && a.thirdPartyId === thirdPartyId);
}

test.describe('Negocio con cruce — comisión única al cierre', () => {
  test('socio 100% + cruce: venta A difiere todo; venta B liquida el negocio', async () => {
    const token = await apiPinLogin();

    // 1. Socio capitalista (inversionista 100%) con cuenta SOCIO fondeada
    //    (patrón cuentas-socio.spec: crear tercero PARTNER → cuenta SOCIO auto).
    const socio = await createThirdParty(token, { name: uniqueName('Socio Cruce'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, socio.id))!;
    expect(socioAccount).toBeTruthy();

    try {
      // Pertenecer al investor_team es lo que hace que resolveSocio lo trate como
      // inversionista (mismo patrón que investors.spec.ts / cuentas-socio.spec.ts).
      const cfgRes = await apiUpdateCommissionConfig(token, {
        ...BASE_COMMISSION_CFG,
        investor_team: [{ thirdPartyId: socio.id, sharePct: 100 }],
      });
      expect(cfgRes.status).toBe(200);

      const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
        fromAccountId: TEST_SEED_IDS.accountCash,
        toAccountId: socioAccount.id,
        amount: 40_000_000,
      });
      expect(fund.status).toBe(201);

      // 2. Vehículo A del socio 100%: purchasePrice 40M, participation auto (0
      //    porque partnerContribution === purchasePrice), partnerContribution 40M,
      //    partnerId del socio → confirm purchase (queda en COMPRADO).
      //    NOTA: no se avanza hasta DISPONIBLE — vehicleService.updateStage exige
      //    salePrice/saleDate ya definidos para permitir DISPONIBLE (esos campos
      //    los fija justamente registerSale), así que esa etapa es inalcanzable
      //    por API antes de vender. registerSale no exige ninguna etapa salvo
      //    "no VENDIDO" (mismo patrón que investors.spec/commissions.spec, que
      //    crean el vehículo directo en COMPRADO y venden de inmediato).
      const plateA = plate('CRA');
      const vehicleA = await apiCreateVehicle(token, {
        plate: plateA,
        stage: 'NEGOCIANDO',
        negotiatedValue: 40_000_000,
        supplierId: TEST_SEED_IDS.supplier,
      });
      await apiConfirmPurchase(token, vehicleA.id, {
        vehicle: {
          purchasePrice: 40_000_000,
          supplierId: TEST_SEED_IDS.supplier,
          partnerId: socio.id,
          partnerContribution: 40_000_000,
        },
        payment: {},
      });

      // 3. Vender A: 50M = 30M efectivo (cuenta seed) + cruce B 20M.
      const plateB = plate('CRB');
      const saleA = await apiRegisterSale(token, vehicleA.id, {
        salePrice: 50_000_000,
        paymentType: 'MIXED',
        buyerId: TEST_SEED_IDS.buyer,
        cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
        tradeIn: { plate: plateB, value: 20_000_000 },
      });
      expect((saleA.summary as { deferred?: boolean }).deferred).toBe(true);
      expect(saleA.newVehicle).toBeTruthy();
      const vehicleBId = saleA.newVehicle!.id;

      // 4. Venta A NO tiene distribución; solo CAPITAL_RETURN parcial = min(efectivo, capital) = 30M.
      const payablesA = await apiListPayables(token, { vehicleId: vehicleA.id });
      expect(payablesA.filter((p) => DISTRIBUTION_TYPES.includes(p.type))).toHaveLength(0);
      const capA = payablesA.find((p) => p.type === 'CAPITAL_RETURN');
      expect(capA).toBeTruthy();
      expect(Number(capA!.totalAmount)).toBe(30_000_000);

      // 5. B (creado por el cruce, NEGOCIANDO) → COMPRADO: se salda solo por el cruce.
      const movedB = await apiMoveStage(token, vehicleBId, 'COMPRADO');
      expect(movedB.stage).toBe('COMPRADO');
      expect(movedB.fromTradeIn).toBe(true);

      // 6. Vender B: 25M efectivo, con un vendedor explícito (participants 100%).
      //    Chain gross = (50−40) + (25−20) = 15M → pool comisión 10% = 1.5M.
      const saleB = await apiRegisterSale(token, vehicleBId, {
        salePrice: 25_000_000,
        paymentType: 'CASH',
        buyerId: TEST_SEED_IDS.buyer,
        cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
        participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
      });

      expect(saleB.summary.grossProfit).toBe(15_000_000);
      expect(saleB.summary.commissionPool).toBe(1_500_000);
      expect(saleB.summary.partnerProfit).toBe(8_100_000);
      expect(saleB.summary.profitToDistribute).toBe(0);

      // 7. Asserts sobre payables de B: COMMISSION 1.5M; COMMISSION_RETURN 1.5M
      //    (socio); PARTNER_SHARE = 15M×0.9 − reservas(30%+10% de 13.5M) = 8.1M;
      //    CAPITAL_RETURN remanente 10M (40M aporte − 30M ya devuelto en A).
      const payablesB = await apiListPayables(token, { vehicleId: vehicleBId });

      const commission = payablesB.find((p) => p.type === 'COMMISSION');
      expect(commission).toBeTruthy();
      expect(Number(commission!.totalAmount)).toBe(1_500_000);

      const commissionReturn = payablesB.find((p) => p.type === 'COMMISSION_RETURN');
      expect(commissionReturn).toBeTruthy();
      expect(commissionReturn!.thirdPartyId).toBe(socio.id);
      expect(Number(commissionReturn!.totalAmount)).toBe(1_500_000);

      const partnerShare = payablesB.find((p) => p.type === 'PARTNER_SHARE');
      expect(partnerShare).toBeTruthy();
      expect(partnerShare!.thirdPartyId).toBe(socio.id);
      expect(Number(partnerShare!.totalAmount)).toBe(8_100_000);

      const capB = payablesB.filter((p) => p.type === 'CAPITAL_RETURN');
      expect(capB).toHaveLength(1);
      expect(capB[0].thirdPartyId).toBe(socio.id);
      expect(Number(capB[0].totalAmount)).toBe(10_000_000);

      // Socio inversionista 100%: se queda con todo (profitToDistribute = 0) →
      // sin CxP PROFIT_SHARE.
      expect(payablesB.filter((p) => p.type === 'PROFIT_SHARE')).toHaveLength(0);

      // 8. GET /commissions → item de B con cascade.chainPlates = [placaA, placaB]
      //    y cascade.grossProfit = 15M (agregado del negocio, no solo de B).
      const items = await apiListCommissions(token);
      const item = items.find((i) => i.vehicle.plate === plateB);
      expect(item).toBeTruthy();
      expect(item!.cascade.grossProfit).toBe(15_000_000);
      const cascadeWithChain = item!.cascade as unknown as { chainPlates?: string[] };
      expect(cascadeWithChain.chainPlates).toEqual([plateA, plateB]);
    } finally {
      // Restaurar investor_team para no contaminar otros specs (settings no se
      // trunca entre tests — mismo patrón que investors.spec.ts).
      await apiUpdateCommissionConfig(token, { ...BASE_COMMISSION_CFG, investor_team: [] });
    }
  });

  test('fondo sin socio + cruce: A difiere, B liquida con PROFIT_SHARE', async () => {
    const token = await apiPinLogin();

    // 1. Vehículo A sin socio: compra 40M 100% cash del fondo.
    const plateA = plate('CFA');
    const vehicleA = await apiCreateVehicle(token, {
      plate: plateA,
      stage: 'NEGOCIANDO',
      negotiatedValue: 40_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiConfirmPurchase(token, vehicleA.id, {
      vehicle: { purchasePrice: 40_000_000, supplierId: TEST_SEED_IDS.supplier },
      payment: { payments: [{ accountId: TEST_SEED_IDS.accountCash, amount: 40_000_000, method: 'CASH' }] },
    });

    // 2. Vender A: 50M = 30M efectivo + cruce B 20M. Sin socio → difiere TODO.
    const plateB = plate('CFB');
    const saleA = await apiRegisterSale(token, vehicleA.id, {
      salePrice: 50_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      tradeIn: { plate: plateB, value: 20_000_000 },
    });
    expect((saleA.summary as { deferred?: boolean }).deferred).toBe(true);
    expect(saleA.newVehicle).toBeTruthy();
    const vehicleBId = saleA.newVehicle!.id;

    // Venta A NO tiene distribución ni CAPITAL_RETURN (no hay socio).
    const payablesA = await apiListPayables(token, { vehicleId: vehicleA.id });
    expect(payablesA.filter((p) => DISTRIBUTION_TYPES.includes(p.type))).toHaveLength(0);
    expect(payablesA.filter((p) => p.type === 'CAPITAL_RETURN')).toHaveLength(0);

    // 3. B (creado por el cruce, NEGOCIANDO) → COMPRADO: se salda solo por el cruce.
    const movedB = await apiMoveStage(token, vehicleBId, 'COMPRADO');
    expect(movedB.stage).toBe('COMPRADO');

    // 4. Vender B: 25M efectivo, con un vendedor explícito (participants 100%).
    //    Chain gross = (50−40) + (25−20) = 15M → pool comisión 10% = 1.5M →
    //    reservas 30%/10% sobre el neto (13.5M) → profitToDistribute = 8.1M al
    //    equipo (fallback owner-self, sin investor_team configurado).
    const saleB = await apiRegisterSale(token, vehicleBId, {
      salePrice: 25_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
      participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
    });

    expect(saleB.summary.grossProfit).toBe(15_000_000);
    expect(saleB.summary.commissionPool).toBe(1_500_000);
    expect(saleB.summary.reinvestAmount).toBe(4_050_000);
    expect(saleB.summary.taxAmount).toBe(1_350_000);
    expect(saleB.summary.profitToDistribute).toBe(8_100_000);

    const payablesB = await apiListPayables(token, { vehicleId: vehicleBId });

    const commission = payablesB.find((p) => p.type === 'COMMISSION');
    expect(commission).toBeTruthy();
    expect(Number(commission!.totalAmount)).toBe(1_500_000);

    const profitShares = payablesB.filter((p) => p.type === 'PROFIT_SHARE');
    const profitSharesSum = profitShares.reduce((s, p) => s + Number(p.totalAmount), 0);
    expect(profitSharesSum).toBe(8_100_000);

    // Invariante de la cascada del negocio: gross − pool − reinvest − tax = Σ PROFIT_SHARE.
    const gross = saleB.summary.grossProfit ?? 0;
    const pool = saleB.summary.commissionPool ?? 0;
    const reinvest = saleB.summary.reinvestAmount ?? 0;
    const tax = saleB.summary.taxAmount ?? 0;
    expect(gross - pool - reinvest - tax).toBe(profitSharesSum);

    // Sin socio en la cadena: sin PARTNER_SHARE ni CAPITAL_RETURN.
    expect(payablesB.filter((p) => p.type === 'PARTNER_SHARE')).toHaveLength(0);
    expect(payablesB.filter((p) => p.type === 'CAPITAL_RETURN')).toHaveLength(0);
  });
});
