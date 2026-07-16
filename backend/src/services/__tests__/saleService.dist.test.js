'use strict';
// ═══════════════════════════════════════════════════════════════
// Integration tests — saleService.registerSale con la cascada nueva
// (comisión a vendedores + ganancia a inversionistas + reservas).
//
// Sin DB: se reemplaza el módulo `../config/database` en el require
// cache por un prisma falso que captura los `*.create` por tipo.
// El stub de `tx` sigue el patrón de `mkTx` de commissionService.test.js,
// ampliado con payable/saleParticipant/transfer/transaction/setting.
// ═══════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Fake prisma inyectado por require cache (antes de requerir saleService) ──
let ctx; // { vehicle, tx, created } — se fija por test
const fakePrisma = {
  vehicle: { findUnique: async () => ctx.vehicle },
  $transaction: async (fn) => fn(ctx.tx),
};
const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const saleService = require('../saleService');

// ── Settings de comisiones (contrato nuevo) ─────────────────────
// Legacy (share_pct) deliberadamente distinto de los nuevos (_pct) para
// verificar que la cascada usa distributionCfg y no los pools viejos.
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
  ]) },
];

const EXISTING_TP = ['hermano', 'owner-self', 'mama', 'papa', 'buyer-1'];

function makeCtx({ vehicle, settings = SETTINGS, existing = EXISTING_TP }) {
  const created = {
    payablesByType: { COMMISSION: [], PROFIT_SHARE: [], RECEIVABLE: [] },
    saleParticipants: [],
    transfers: [],
    transactions: [],
    payablePayments: [],
  };
  let idn = 0;
  const nid = (p) => `${p}-${++idn}`;
  const has = new Set(existing);
  const tx = {
    vehicle: {
      update: async ({ data }) => ({ ...vehicle, ...data }),
      create: async ({ data }) => ({ id: nid('veh'), ...data }),
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
    },
  };
  return { vehicle, tx, created };
}

const baseVehicle = (over = {}) => ({
  id: 'veh-1', plate: 'ABC123', stage: 'DISPONIBLE',
  purchasePrice: 15_000_000, negotiatedValue: null, fromTradeIn: false,
  participation: 1, userId: 'u-1', expenses: [],
  ...over,
});

const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

// ── Escenario base: 20M / costo 15M, 1 vendedor 100%, capital 50/25/25 ──
test('registerSale: 1 CxP COMMISSION + 3 PROFIT_SHARE; sumas cuadran con la cascada', async () => {
  ctx = makeCtx({ vehicle: baseVehicle() });
  const res = await saleService.registerSale('veh-1', {
    salePrice: 20_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 20_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  const { payablesByType } = ctx.created;
  assert.equal(payablesByType.COMMISSION.length, 1);
  assert.equal(payablesByType.PROFIT_SHARE.length, 3);
  assert.equal(sum(payablesByType.PROFIT_SHARE, 'totalAmount'), 2_700_000);
  assert.equal(payablesByType.COMMISSION[0].totalAmount, 500_000);

  // SaleParticipant: 1 vendedor + 3 inversionistas, con roles correctos
  assert.equal(ctx.created.saleParticipants.length, 4);
  const investorSps = ctx.created.saleParticipants.filter((s) => s.role === 'INVESTOR');
  assert.equal(investorSps.length, 3);

  // Summary de distribución expuesto en el resultado
  assert.equal(res.summary.commissionPool, 500_000);
  assert.equal(res.summary.profitToDistribute, 2_700_000);
});

test('registerSale: reservas proporcionales al efectivo (cash total → ratio 1)', async () => {
  ctx = makeCtx({ vehicle: baseVehicle() });
  await saleService.registerSale('veh-1', {
    salePrice: 20_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 20_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  // reinvest 1.35M + tax 0.45M (30%/10% de afterCommission 4.5M) con ratio 1
  assert.equal(ctx.created.transfers.length, 2);
  const toReinvest = ctx.created.transfers.find((t) => t.toAccountId === 'budget-reinvest');
  const toTax = ctx.created.transfers.find((t) => t.toAccountId === 'budget-tax');
  assert.equal(Number(toReinvest.amount), 1_350_000);
  assert.equal(Number(toTax.amount), 450_000);
});

test('registerSale: reservas a la mitad del efectivo → montos a la mitad; CxP full', async () => {
  ctx = makeCtx({ vehicle: baseVehicle() });
  await saleService.registerSale('veh-1', {
    salePrice: 20_000_000,
    paymentType: 'MIXED',
    cashPayment: { accountId: 'acc-cash', amount: 10_000_000, method: 'CASH' },
    financing: { dueDate: null },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  // cashRatio = 10M/10M recibido = 1 (no hay cruce); pero recibido < precio → CxC.
  // Efectivo recibido = 10M, totalReceived = 10M → ratio 1; reservas full.
  // CxP de comisión/ganancia se crean por el monto completo igualmente.
  assert.equal(ctx.created.payablesByType.COMMISSION.length, 1);
  assert.equal(ctx.created.payablesByType.PROFIT_SHARE.length, 3);
  assert.equal(sum(ctx.created.payablesByType.PROFIT_SHARE, 'totalAmount'), 2_700_000);
  assert.equal(ctx.created.payablesByType.COMMISSION[0].totalAmount, 500_000);
});

test('registerSale: venta sin utilidad (skip) → sin CxP de reparto ni reservas', async () => {
  ctx = makeCtx({ vehicle: baseVehicle({ purchasePrice: 22_000_000 }) });
  await saleService.registerSale('veh-1', {
    salePrice: 20_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 20_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  assert.equal(ctx.created.payablesByType.COMMISSION.length, 0);
  assert.equal(ctx.created.payablesByType.PROFIT_SHARE.length, 0);
  assert.equal(ctx.created.transfers.length, 0);
  assert.equal(ctx.created.saleParticipants.length, 0);
});

test('registerSale: sin vendedores → 0 COMMISSION, 3 PROFIT_SHARE por 3M', async () => {
  ctx = makeCtx({ vehicle: baseVehicle() });
  await saleService.registerSale('veh-1', {
    salePrice: 20_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 20_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [], // sin vendedores explícitos y sin sellerTeam → sin comisión
  }, 'u-1');

  assert.equal(ctx.created.payablesByType.COMMISSION.length, 0);
  assert.equal(ctx.created.payablesByType.PROFIT_SHARE.length, 3);
  assert.equal(sum(ctx.created.payablesByType.PROFIT_SHARE, 'totalAmount'), 3_000_000);
});
