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
