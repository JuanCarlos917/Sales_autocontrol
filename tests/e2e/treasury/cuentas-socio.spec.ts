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
  type Account,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

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
});
