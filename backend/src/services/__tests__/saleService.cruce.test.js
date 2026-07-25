'use strict';
// ═══════════════════════════════════════════════════════════════
// Integration tests — registerSale con cruce (diferimiento) y cierre
// de negocio (Task 5). Fake prisma por require cache, patrón de
// saleService.dist.test.js.
// ═══════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { vehicle, chainNodes, priorPayables, tx, created } — por test
const fakePrisma = {
  vehicle: { findUnique: async () => ctx.vehicle },
  $transaction: async (fn) => fn(ctx.tx),
};
const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const saleService = require('../saleService');

const SETTINGS = [
  { key: 'commission_share_pct', value: '60' },
  { key: 'reinvest_share_pct', value: '30' },
  { key: 'tax_share_pct', value: '10' },
  { key: 'default_captador_pct', value: '30' },
  { key: 'default_cerrador_pct', value: '70' },
  { key: 'reinvest_account_id', value: 'budget-reinvest' },
  { key: 'tax_reserve_account_id', value: 'budget-tax' },
  { key: 'commission_gross_pct', value: '10' },
  { key: 'reinvest_pct', value: '30' },
  { key: 'tax_pct', value: '10' },
  { key: 'investor_team', value: JSON.stringify([
    { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
    { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
    { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
    { thirdPartyId: 'socio-cap', role: 'INVESTOR', sharePct: 0.0001 }, // pertenece al equipo → isInvestor
  ]) },
];
// Nota: resolveInvestors exige suma 100 SOLO cuando reparte PROFIT_SHARE; para
// que el equipo valga, usar en los tests de fondo un team que sume 100:
const FUND_SETTINGS = SETTINGS.map((s) => s.key === 'investor_team'
  ? { ...s, value: JSON.stringify([
      { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
      { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
      { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
    ]) }
  : s);
// Team con socio-cap como inversionista y suma 100 (socio 100% no reparte PROFIT_SHARE):
const SOCIO_SETTINGS = SETTINGS.map((s) => s.key === 'investor_team'
  ? { ...s, value: JSON.stringify([
      { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
      { thirdPartyId: 'socio-cap', role: 'INVESTOR', sharePct: 50 },
    ]) }
  : s);

const EXISTING_TP = ['hermano', 'owner-self', 'mama', 'papa', 'buyer-1', 'socio-cap', 'ext-socio'];

function makeCtx({ vehicle, chainNodes = [], priorPayables = [], settings = FUND_SETTINGS, existing = EXISTING_TP }) {
  const created = {
    payablesByType: {},
    saleParticipants: [],
    transfers: [],
    transactions: [],
    payablePayments: [],
  };
  let idn = 0;
  const nid = (p) => `${p}-${++idn}`;
  const has = new Set(existing);
  const nodesById = new Map(chainNodes.map((n) => [n.id, n]));
  const tx = {
    vehicle: {
      update: async ({ data }) => ({ ...vehicle, ...data }),
      create: async ({ data }) => ({ id: nid('veh'), ...data }),
      findMany: async ({ where }) => {
        const ids = where.id?.in ?? [where.id];
        return ids.map((id) => nodesById.get(id)).filter(Boolean);
      },
    },
    transaction: {
      create: async ({ data }) => { const r = { id: nid('txn'), ...data }; created.transactions.push(r); return r; },
    },
    payable: {
      create: async ({ data }) => {
        const r = { id: nid('pay'), ...data };
        (created.payablesByType[data.type] || (created.payablesByType[data.type] = [])).push(r);
        return r;
      },
      findMany: async ({ where }) => priorPayables.filter((p) =>
        (where.vehicleId?.in ?? [where.vehicleId]).includes(p.vehicleId)
        && (!where.type || where.type.in.includes(p.type))),
      aggregate: async ({ where }) => {
        const sum = priorPayables
          .filter((p) => (where.vehicleId?.in ?? [where.vehicleId]).includes(p.vehicleId)
            && p.type === where.type
            && (!where.thirdPartyId || p.thirdPartyId === where.thirdPartyId))
          .reduce((s, p) => s + Number(p.totalAmount), 0);
        return { _sum: { totalAmount: sum } };
      },
    },
    payablePayment: {
      create: async ({ data }) => { created.payablePayments.push(data); return data; },
    },
    saleParticipant: {
      create: async ({ data }) => { const r = { id: nid('sp'), ...data }; created.saleParticipants.push(r); return r; },
    },
    transfer: {
      create: async ({ data }) => { const r = { id: nid('tr'), ...data }; created.transfers.push(r); return r; },
    },
    setting: { findMany: async () => settings },
    thirdParty: {
      findMany: async ({ where }) => where.id.in.filter((id) => has.has(id)).map((id) => ({ id })),
      findUnique: async ({ where }) => (has.has(where.id) ? { id: where.id } : null),
      update: async ({ data }) => data,
    },
  };
  return { vehicle, chainNodes, priorPayables, tx, created };
}

const count = (created, type) => (created.payablesByType[type] || []).length;

// ── Vehículo base del fondo (sin socio) ─────────────────────────
const FUND_VEHICLE = {
  id: 'veh-a', plate: 'AAA111', stage: 'DISPONIBLE', userId: 'user-1',
  purchasePrice: 40_000_000, negotiatedValue: null, fromTradeIn: false,
  participation: 1, partnerId: null, partnerContribution: null, expenses: [],
};
// Socio inversionista 100%: partnerId en investor_team, participation 0.
const SOCIO_VEHICLE = {
  ...FUND_VEHICLE, partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000,
};

const TRADE_IN = { plate: 'BBB222', value: 20_000_000 };

test('cruce sin socio: NO crea distribución (ni COMMISSION ni PROFIT_SHARE ni transfers); summary.deferred', async () => {
  ctx = makeCtx({ vehicle: FUND_VEHICLE });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'PROFIT_SHARE'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'CAPITAL_RETURN'), 0);
  assert.equal(ctx.created.transfers.length, 0);
  assert.equal(res.summary.deferred, true);
  assert.equal(res.summary.reason, 'trade_in');
  assert.equal(res.summary.deferredToPlate, 'BBB222');
  assert.ok(res.newVehicle); // el cruce sí se crea
});

test('cruce + socio inversionista 100%: solo CAPITAL_RETURN parcial = min(efectivo, capital)', async () => {
  ctx = makeCtx({ vehicle: SOCIO_VEHICLE, settings: SOCIO_SETTINGS });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
  }, 'user-1');

  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 30_000_000); // min(30M efectivo, 40M capital)
  assert.equal(caps[0].thirdPartyId, 'socio-cap');
  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(res.summary.deferred, true);
});

test('cruce 100% carro (efectivo 0) + socio inversionista: sin CAPITAL_RETURN', async () => {
  ctx = makeCtx({ vehicle: SOCIO_VEHICLE, settings: SOCIO_SETTINGS });
  await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'TRADE_IN', buyerId: 'buyer-1',
    tradeIn: { plate: 'BBB222', value: 50_000_000 },
  }, 'user-1');
  assert.equal(count(ctx.created, 'CAPITAL_RETURN'), 0);
});

test('cruce + socio EXTERNO parcial: flujo inmediato intacto (COMMISSION + PARTNER_SHARE + CxC)', async () => {
  const extVehicle = { ...FUND_VEHICLE, partnerId: 'ext-socio', participation: 0.6, partnerContribution: null };
  ctx = makeCtx({ vehicle: extVehicle });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // gross 10M → pool 1M; socio externo 40%: PARTNER_SHARE 4M, CxC comisión 400k.
  assert.equal(count(ctx.created, 'COMMISSION'), 1);
  assert.equal((ctx.created.payablesByType.PARTNER_SHARE || [])[0].totalAmount, 4_000_000);
  const socioRec = (ctx.created.payablesByType.RECEIVABLE || []).find((p) => /Comisión socio/.test(p.description));
  assert.ok(socioRec);
  assert.equal(res.summary.deferred, undefined);
});

// ── Cierre de cadena (Task 5) ───────────────────────────────────
// B (fromTradeIn de A) se vende sin nuevo cruce → liquida el negocio.
const NODE_A_SOCIO = {
  id: 'veh-a', plate: 'AAA111', stage: 'VENDIDO', salePrice: 50_000_000,
  purchasePrice: 40_000_000, negotiatedValue: null, fromTradeIn: false,
  saleDate: new Date('2026-07-01'), sourceVehicleId: null,
  partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000,
  expenses: [], tradeInIds: [], tradeInsReceived: [{ id: 'veh-b' }],
};
const NODE_A_FUND = { ...NODE_A_SOCIO, partnerId: null, participation: 1, partnerContribution: null };
// Nodo de B "en DB dentro de la tx": ya VENDIDO con salePrice (el update del
// paso 1 de registerSale es visible dentro de la misma transacción).
const NODE_B = (salePrice) => ({
  id: 'veh-b', plate: 'BBB222', stage: 'VENDIDO', salePrice,
  purchasePrice: null, negotiatedValue: 20_000_000, fromTradeIn: true,
  saleDate: new Date('2026-07-20'), sourceVehicleId: 'veh-a',
  partnerId: null, participation: 1, partnerContribution: null,
  expenses: [{ amount: 1_000_000, deletedAt: null }], tradeInsReceived: [],
});
// Vehículo B tal como lo ve findUnique ANTES de la venta.
const VEHICLE_B = {
  id: 'veh-b', plate: 'BBB222', stage: 'DISPONIBLE', userId: 'user-1',
  purchasePrice: null, negotiatedValue: 20_000_000, fromTradeIn: true,
  sourceVehicleId: 'veh-a', participation: 1, partnerId: null, partnerContribution: null,
  expenses: [{ amount: 1_000_000, deletedAt: null }],
};

test('cierre con socio 100%: cascada sobre 14M; COMMISSION_RETURN + PARTNER_SHARE + CAPITAL_RETURN remanente', async () => {
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(25_000_000)],
    // Parcial de capital creado al vender A (rama defer).
    priorPayables: [{ vehicleId: 'veh-a', type: 'CAPITAL_RETURN', thirdPartyId: 'socio-cap', totalAmount: 30_000_000 }],
    settings: SOCIO_SETTINGS,
  });
  const res = await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // Chain gross = (50−40−0) + (25−20−1) = 14M; pool 10% = 1.4M.
  const comm = ctx.created.payablesByType.COMMISSION || [];
  assert.equal(comm.length, 1);
  assert.equal(comm[0].totalAmount, 1_400_000);
  const commRet = ctx.created.payablesByType.COMMISSION_RETURN || [];
  assert.equal(commRet[0].totalAmount, 1_400_000);
  assert.equal(commRet[0].thirdPartyId, 'socio-cap');
  // afterCommission 12.6M − reinvest 3.78M − tax 1.26M = 7.56M al socio.
  const ps = ctx.created.payablesByType.PARTNER_SHARE || [];
  assert.equal(ps[0].totalAmount, 7_560_000);
  // Capital remanente: 40M − 30M ya adeudados = 10M.
  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 10_000_000);
  // Inversionista 100% → sin PROFIT_SHARE; reservas con cashRatio 1.
  assert.equal(count(ctx.created, 'PROFIT_SHARE'), 0);
  assert.equal(ctx.created.transfers.length, 2);
  assert.deepEqual(res.summary.chain, { plates: ['AAA111', 'BBB222'], grossProfit: 14_000_000 });
});

test('cierre compat: A ya distribuyó → base solo B (4M), cascada de fondo', async () => {
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(25_000_000)],
    priorPayables: [{ vehicleId: 'veh-a', type: 'COMMISSION', thirdPartyId: 'hermano', totalAmount: 1 }],
  });
  const res = await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // Base 4M: pool 400k; after 3.6M; reinvest 1.08M; tax 360k; profit 2.16M (50/25/25).
  assert.equal((ctx.created.payablesByType.COMMISSION || [])[0].totalAmount, 400_000);
  const shares = (ctx.created.payablesByType.PROFIT_SHARE || []).map((p) => p.totalAmount).sort((a, b) => b - a);
  assert.deepEqual(shares, [1_080_000, 540_000, 540_000]);
  // A excluido → su socio NO lidera: sin PARTNER_SHARE ni COMMISSION_RETURN.
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.deepEqual(res.summary.chain.plates, ['BBB222']);
});

test('cierre sin ganancia: skip de cascada pero CAPITAL_RETURN remanente sí se crea', async () => {
  // B se vende en 5M → chain = 10M + (5−20−1) = −6M.
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(5_000_000)],
    priorPayables: [{ vehicleId: 'veh-a', type: 'CAPITAL_RETURN', thirdPartyId: 'socio-cap', totalAmount: 30_000_000 }],
    settings: SOCIO_SETTINGS,
  });
  await saleService.registerSale('veh-b', {
    salePrice: 5_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 5_000_000 },
  }, 'user-1');

  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(ctx.created.transfers.length, 0);
  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 10_000_000);
});

test('cierre sin socio en la cadena: cascada de fondo sobre 14M', async () => {
  ctx = makeCtx({ vehicle: VEHICLE_B, chainNodes: [NODE_A_FUND, NODE_B(25_000_000)] });
  await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  assert.equal((ctx.created.payablesByType.COMMISSION || [])[0].totalAmount, 1_400_000);
  // after 12.6M − 3.78M − 1.26M = 7.56M repartidos 50/25/25.
  const shares = (ctx.created.payablesByType.PROFIT_SHARE || []).map((p) => p.totalAmount).sort((a, b) => b - a);
  assert.deepEqual(shares, [3_780_000, 1_890_000, 1_890_000]);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
});
