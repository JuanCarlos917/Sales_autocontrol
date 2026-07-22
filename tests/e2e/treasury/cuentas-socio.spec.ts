import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiRequestRaw,
  apiListAccounts,
  apiGetAccount,
  apiCreateVehicle,
  apiConfirmPurchase,
  apiMoveStage,
  apiGetVehiclePaymentStatus,
  apiListPayables,
  apiListTransactions,
  apiReverseAccountRaw,
  apiRegisterSale,
  apiUpdateCommissionConfig,
  type Account,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Campos legacy que el schema Joi de PUT /settings/commission-config sigue
// exigiendo como `required()` — mismo patrón que investors.spec.ts /
// commission-split-team.spec.ts.
const BASE_COMMISSION_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

// Cuentas dedicadas por socio (FASE A, Tasks 1-4): marcar un tercero como
// PARTNER crea (idempotente) una cuenta `SOCIO` propia (`ensureSocioAccount`,
// thirdPartyService). El aporte de un socio en la compra (`partnerContribution`)
// ya no es un par INCOME+EXPENSE neto $0 por una cuenta cualquiera (Opción B,
// superada) — ahora es UN SOLO EXPENSE que sale de la cuenta SOCIO del
// `partnerId` del vehículo (purchaseService.applyPurchasePayments). Sin una
// cuenta SOCIO activa para ese tercero, la compra responde 400. Las cuentas
// SOCIO son cuentas normales para todo lo demás: admiten transferencias.

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

test.describe('Cuentas dedicadas por socio', () => {
  test('crear un tercero tipo Socio (PARTNER) crea automáticamente su cuenta SOCIO', async () => {
    const token = await apiPinLogin();
    const name = uniqueName('Socio Nuevo');

    const tp = await createThirdParty(token, { name, type: 'PARTNER' });
    expect(tp.type).toBe('PARTNER');

    const socioAccount = await findSocioAccount(token, tp.id);
    expect(socioAccount).toBeTruthy();
    expect(socioAccount!.name).toBe(`Cuenta Socio — ${name}`);
    expect(socioAccount!.isActive).toBe(true);
  });

  test('editar un tercero existente a tipo Socio crea su cuenta SOCIO (idempotente al repetir)', async () => {
    const token = await apiPinLogin();
    const name = uniqueName('Cliente a Socio');

    const tp = await createThirdParty(token, { name, type: 'CLIENT' });
    expect(await findSocioAccount(token, tp.id)).toBeUndefined();

    const upd = await apiRequestRaw('PUT', `/treasury/third-parties/${tp.id}`, token, { name, type: 'PARTNER' });
    expect(upd.status).toBe(200);

    const socioAccount = await findSocioAccount(token, tp.id);
    expect(socioAccount).toBeTruthy();
    expect(socioAccount!.name).toBe(`Cuenta Socio — ${name}`);

    // Repetir el mismo PUT (sigue siendo PARTNER) no crea una segunda cuenta.
    const upd2 = await apiRequestRaw('PUT', `/treasury/third-parties/${tp.id}`, token, { name, type: 'PARTNER' });
    expect(upd2.status).toBe(200);
    const accountsAfter = await apiListAccounts(token);
    const socioAccounts = accountsAfter.filter((a) => a.type === 'SOCIO' && a.thirdPartyId === tp.id);
    expect(socioAccounts).toHaveLength(1);
  });

  test('fondear la cuenta del socio (transferencia) y comprar aportando el 40%: egreso único desde su cuenta, CxP PAID, avanza de etapa', async () => {
    const token = await apiPinLogin();
    const tp = await createThirdParty(token, { name: uniqueName('Socio 40%'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, tp.id))!;
    expect(socioAccount).toBeTruthy();

    const FONDEO = 10_000_000;
    const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: socioAccount.id,
      amount: FONDEO,
    });
    expect(fund.status).toBe(201);
    expect(parseFloat((await apiGetAccount(token, socioAccount.id)).currentBalance as string)).toBe(FONDEO);

    const PURCHASE_PRICE = 20_000_000;
    const PARTNER_CONTRIBUTION = 8_000_000;
    const MY_PART = 12_000_000;
    const p = plate('CS4');

    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: {
        purchasePrice: PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
        partnerId: tp.id,
        partnerContribution: PARTNER_CONTRIBUTION,
      },
      payment: {
        payments: [{ accountId: TEST_SEED_IDS.accountCash, amount: MY_PART, method: 'CASH' }],
      },
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
    expect(status.purchase!.pendingAmount).toBe(0);
    expect(status.purchase!.status).toBe('PAID');

    const payables = await apiListPayables(token, { vehicleId: v.id, type: 'PAYABLE' });
    expect(payables).toHaveLength(1);
    expect(payables[0].status).toBe('PAID');
    expect(Number(payables[0].totalAmount)).toBe(PURCHASE_PRICE);

    // Un único EXPENSE por el aporte, desde la cuenta SOCIO — sin INCOME.
    const txs = await apiListTransactions(token, { vehicleId: v.id });
    expect(txs.filter((t) => t.type === 'INCOME')).toHaveLength(0);
    const expenses = txs.filter((t) => t.type === 'EXPENSE');
    expect(expenses).toHaveLength(2);
    const aporteExpense = expenses.find((e) => e.accountId === socioAccount.id);
    expect(aporteExpense).toBeTruthy();
    expect(aporteExpense!.category).toBe('VEHICLE_PURCHASE');
    expect(Number(aporteExpense!.amount)).toBe(PARTNER_CONTRIBUTION);
    const myExpense = expenses.find((e) => e.accountId === TEST_SEED_IDS.accountCash);
    expect(myExpense).toBeTruthy();
    expect(Number(myExpense!.amount)).toBe(MY_PART);

    expect(parseFloat((await apiGetAccount(token, socioAccount.id)).currentBalance as string))
      .toBe(FONDEO - PARTNER_CONTRIBUTION);

    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');
  });

  test('socio aporta el 100% del precio: CxP PAID sin pago propio, avanza de etapa', async () => {
    const token = await apiPinLogin();
    const tp = await createThirdParty(token, { name: uniqueName('Socio 100%'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, tp.id))!;

    const PURCHASE_PRICE = 20_000_000;
    const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: socioAccount.id,
      amount: PURCHASE_PRICE,
    });
    expect(fund.status).toBe(201);

    const p = plate('CS1');
    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: {
        purchasePrice: PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
        partnerId: tp.id,
        partnerContribution: PURCHASE_PRICE,
      },
      payment: {},
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
    expect(status.purchase!.status).toBe('PAID');

    const txs = await apiListTransactions(token, { vehicleId: v.id });
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('EXPENSE');
    expect(txs[0].accountId).toBe(socioAccount.id);
    expect(Number(txs[0].amount)).toBe(PURCHASE_PRICE);

    expect(parseFloat((await apiGetAccount(token, socioAccount.id)).currentBalance as string)).toBe(0);

    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');
  });

  test('transferir desde la cuenta del socio hacia otra cuenta: débita origen, acredita destino', async () => {
    const token = await apiPinLogin();
    const tp = await createThirdParty(token, { name: uniqueName('Socio Transfiere'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, tp.id))!;

    const FONDEO = 5_000_000;
    await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: socioAccount.id,
      amount: FONDEO,
    });

    const cashBefore = parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string);

    const OUT = 2_000_000;
    const out = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: socioAccount.id,
      toAccountId: TEST_SEED_IDS.accountCash,
      amount: OUT,
    });
    expect(out.status).toBe(201);

    expect(parseFloat((await apiGetAccount(token, socioAccount.id)).currentBalance as string)).toBe(FONDEO - OUT);
    expect(parseFloat((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string))
      .toBe(cashBefore + OUT);
  });

  test('socio sin cuenta activa: comprar con su aporte responde 400 accionable', async () => {
    const token = await apiPinLogin();
    const tp = await createThirdParty(token, { name: uniqueName('Socio Sin Cuenta'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, tp.id))!;
    expect(socioAccount).toBeTruthy();

    // Cuenta recién creada, sin saldo ni movimientos: se puede desactivar.
    const reverse = await apiReverseAccountRaw(token, socioAccount.id, 'cuenta de socio de prueba, ya no se usa');
    expect(reverse.status).toBe(200);
    expect(reverse.body.isActive).toBe(false);

    const p = plate('CS0');
    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: 20_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/confirm-purchase`, token, {
      vehicle: {
        purchasePrice: 20_000_000,
        supplierId: TEST_SEED_IDS.supplier,
        partnerId: tp.id,
        partnerContribution: 8_000_000,
      },
      payment: {
        payments: [{ accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000, method: 'CASH' }],
      },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string })?.error).toMatch(/cuenta activa/i);
  });

  // Cierra el hueco identificado en la revisión de Task 5: un socio PARTNER
  // (con cuenta SOCIO propia) que ADEMÁS pertenece al `investor_team`
  // reproduce el caso "socio inversionista al 100%" de punta a punta —
  // resolveSocio (commissionService) clasifica como inversionista a quien es
  // 'owner-self' O figura en investor_team, sin importar el tipo de tercero.
  // Antes de este test, la compra-100%-desde-cuenta-socio (cuentas-socio.spec,
  // test anterior) y la venta-100%-inversionista (socio.spec, con owner-self)
  // se probaban por separado; nunca la cadena completa compra real → venta.
  test('socio PARTNER en investor_team aporta el 100% en la compra (cuenta SOCIO) y al vender cobra su ganancia como PARTNER_SHARE', async () => {
    const token = await apiPinLogin();
    const tp = await createThirdParty(token, { name: uniqueName('Socio Inversionista'), type: 'PARTNER' });
    const socioAccount = (await findSocioAccount(token, tp.id))!;
    expect(socioAccount).toBeTruthy();

    const PURCHASE_PRICE = 20_000_000;
    const SALE_PRICE = 30_000_000;

    try {
      // Pertenecer al investor_team es lo que hace que resolveSocio lo trate
      // como inversionista (isInvestor = true) al vender, permitiendo share === 1.
      const cfgRes = await apiUpdateCommissionConfig(token, {
        ...BASE_COMMISSION_CFG,
        investor_team: [{ thirdPartyId: tp.id, sharePct: 100 }],
      });
      expect(cfgRes.status).toBe(200);

      const fund = await apiRequestRaw('POST', '/treasury/transfers', token, {
        fromAccountId: TEST_SEED_IDS.accountCash,
        toAccountId: socioAccount.id,
        amount: PURCHASE_PRICE,
      });
      expect(fund.status).toBe(201);

      const p = plate('CSI');
      const v = await apiCreateVehicle(token, {
        plate: p,
        stage: 'NEGOCIANDO',
        negotiatedValue: PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
      });

      // Compra: el socio aporta el 100% desde su cuenta SOCIO (partnerContribution
      // === purchasePrice → participation se auto-calcula en 0, ver
      // calculateParticipation en financial.js).
      await apiConfirmPurchase(token, v.id, {
        vehicle: {
          purchasePrice: PURCHASE_PRICE,
          supplierId: TEST_SEED_IDS.supplier,
          partnerId: tp.id,
          partnerContribution: PURCHASE_PRICE,
        },
        payment: {},
      });

      const status = await apiGetVehiclePaymentStatus(token, v.id);
      expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
      expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
      expect(status.purchase!.status).toBe('PAID');

      const purchasePayables = await apiListPayables(token, { vehicleId: v.id, type: 'PAYABLE' });
      expect(purchasePayables).toHaveLength(1);
      expect(purchasePayables[0].status).toBe('PAID');

      // Un único EXPENSE, desde la cuenta SOCIO — sin pago propio.
      const purchaseTxs = await apiListTransactions(token, { vehicleId: v.id });
      expect(purchaseTxs).toHaveLength(1);
      expect(purchaseTxs[0].type).toBe('EXPENSE');
      expect(purchaseTxs[0].accountId).toBe(socioAccount.id);
      expect(Number(purchaseTxs[0].amount)).toBe(PURCHASE_PRICE);
      expect(parseFloat((await apiGetAccount(token, socioAccount.id)).currentBalance as string)).toBe(0);

      const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
      expect(advanced.stage).toBe('ALISTAMIENTO');

      // Venta: gross 10M (30M − 20M). Con socioShare === 1 (participation 0),
      // las reservas se calculan sobre TODO el neto y el fondo no recibe nada
      // (mismos números que socio.spec.ts "socio inversionista al 100%", ahí
      // con owner-self; aquí con un tercero PARTNER real vía investor_team).
      const sale = await apiRegisterSale(token, v.id, {
        salePrice: SALE_PRICE,
        paymentType: 'CASH',
        buyerId: TEST_SEED_IDS.buyer,
        cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SALE_PRICE },
        participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
      });

      expect(sale.summary.grossProfit).toBe(10_000_000);
      expect(sale.summary.socioShare).toBe(1);
      expect(sale.summary.reinvestAmount).toBe(2_700_000);
      expect(sale.summary.taxAmount).toBe(900_000);
      // Ganancia del socio NETA de comisión: afterCommission (9M) − reservas
      // (2.7M + 0.9M) = 5.4M. La comisión ya no se resta contra una CxC por
      // cobrar; se deposita en la cuenta del socio vía CxP COMMISSION_RETURN.
      expect(sale.summary.partnerProfit).toBe(5_400_000);
      expect(sale.summary.partnerCommissionOwed).toBe(1_000_000);
      expect(sale.summary.profitToDistribute).toBe(0);

      // La ganancia del socio (participation calculada fresca en la compra →
      // socioShare = 1 en la cascada de venta) llega como CxP PARTNER_SHARE.
      const payables = await apiListPayables(token, { vehicleId: v.id });
      const partnerShare = payables.find((pb) => pb.type === 'PARTNER_SHARE');
      expect(partnerShare).toBeTruthy();
      expect(partnerShare!.thirdPartyId).toBe(tp.id);
      expect(Number(partnerShare!.totalAmount)).toBe(5_400_000);

      // Inversionista 100%: el pool de comisión se deposita en la cuenta del
      // socio como CxP COMMISSION_RETURN (no se crea la CxC RECEIVABLE del
      // modelo de socio externo).
      const commissionReturn = payables.find((pb) => pb.type === 'COMMISSION_RETURN');
      expect(commissionReturn).toBeTruthy();
      expect(commissionReturn!.thirdPartyId).toBe(tp.id);
      expect(Number(commissionReturn!.totalAmount)).toBe(1_000_000);
      expect(payables.some((pb) => pb.type === 'RECEIVABLE')).toBe(false);

      // Sin fila de PROFIT_SHARE: profitToDistribute === 0 no crea CxP vacías.
      expect(payables.filter((pb) => pb.type === 'PROFIT_SHARE')).toHaveLength(0);
    } finally {
      // Restaurar investor_team para no contaminar otros specs (settings no
      // se trunca entre tests — mismo patrón que investors.spec.ts).
      await apiUpdateCommissionConfig(token, { ...BASE_COMMISSION_CFG, investor_team: [] });
    }
  });
});
