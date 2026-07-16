'use strict';
// ═══════════════════════════════════════════════════════════════
// settingsController.updateCommissionConfig — validación de los campos
// nuevos de la cascada ganancia (Task 8): pct editables (gross/reinvest/tax)
// e investor_team (equipo de inversionistas, owner-self permitido).
//
// Mismo patrón que saleService.cancel.test.js: se reemplaza el módulo
// `../config/database` en el require cache por un prisma falso antes de
// requerir el controller, así no se necesita DB real ni servidor Express.
// ═══════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { thirdParties, upsertCalls } — se fija por test

const fakePrisma = {
  account: {
    findMany: async () => ([
      { id: 'acc-reinvest', type: 'BUDGET', isActive: true },
      { id: 'acc-tax', type: 'BUDGET', isActive: true },
    ]),
  },
  thirdParty: {
    findMany: async ({ where }) => {
      const ids = where.id.in;
      return (ctx.thirdParties || []).filter((tp) => ids.includes(tp.id));
    },
  },
  setting: {
    upsert: (args) => { ctx.upsertCalls.push(args); return Promise.resolve({}); },
    findMany: async () => ctx.settingRows || [],
  },
  $transaction: async (arr) => Promise.all(arr),
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const settingsController = require('../settingsController');

function mkRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function mkNext() {
  const calls = [];
  const next = (err) => { calls.push(err); };
  next.calls = calls;
  return next;
}

// Payload legacy válido (bucket sum=100, split=100, cuentas BUDGET activas) —
// las pruebas solo varían los campos nuevos de Task 8 sobre esta base.
const basePayload = (overrides = {}) => ({
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'acc-reinvest',
  tax_reserve_account_id: 'acc-tax',
  commission_default_team: [],
  ...overrides,
});

test('updateCommissionConfig: investor_team con owner-self incluido y suma 100 → aceptado', async () => {
  ctx = {
    thirdParties: [{ id: 'owner-self' }, { id: 'mama' }, { id: 'papa' }],
    upsertCalls: [],
  };
  const req = { body: basePayload({
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 50 },
      { thirdPartyId: 'mama', sharePct: 25 },
      { thirdPartyId: 'papa', sharePct: 25 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'Configuración de comisiones actualizada' });
});

test('updateCommissionConfig: investor_team sumando 90 (no 100) → 400', async () => {
  ctx = {
    thirdParties: [{ id: 'owner-self' }, { id: 'mama' }],
    upsertCalls: [],
  };
  const req = { body: basePayload({
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 60 },
      { thirdPartyId: 'mama', sharePct: 30 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /90/);
  assert.match(res.body.error, /suman|100/);
});

test('updateCommissionConfig: investor_team vacío → aceptado (fallback owner-self en resolveInvestors)', async () => {
  ctx = { thirdParties: [{ id: 'owner-self' }], upsertCalls: [] };
  const req = { body: basePayload({ investor_team: [] }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.equal(res.statusCode, 200);
});

test('updateCommissionConfig: investor_team con thirdPartyId repetido → 400', async () => {
  ctx = { thirdParties: [{ id: 'owner-self' }], upsertCalls: [] };
  const req = { body: basePayload({
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 50 },
      { thirdPartyId: 'owner-self', sharePct: 50 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /repetid/i);
});

test('updateCommissionConfig: investor_team con sharePct <= 0 → 400', async () => {
  ctx = { thirdParties: [{ id: 'owner-self' }, { id: 'mama' }], upsertCalls: [] };
  const req = { body: basePayload({
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 0 },
      { thirdPartyId: 'mama', sharePct: 100 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /mayor a 0/);
});

test('updateCommissionConfig: investor_team con tercero inexistente → 400', async () => {
  ctx = { thirdParties: [{ id: 'owner-self' }], upsertCalls: [] };
  const req = { body: basePayload({
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 50 },
      { thirdPartyId: 'no-existe', sharePct: 50 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /no existe/i);
});

test('updateCommissionConfig: reinvest_pct=70 + tax_pct=40 (suman >100) → 400', async () => {
  ctx = { thirdParties: [], upsertCalls: [] };
  const req = { body: basePayload({ reinvest_pct: 70, tax_pct: 40 }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /reinvest_pct/);
  assert.match(res.body.error, /110/);
});

test('updateCommissionConfig: commission_gross_pct fuera de rango (150) → 400', async () => {
  ctx = { thirdParties: [], upsertCalls: [] };
  const req = { body: basePayload({ commission_gross_pct: 150 }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /commission_gross_pct/);
});

test('updateCommissionConfig: reinvest_pct + tax_pct independientes de los 3 bolsillos legacy (no exigen sumar 100 entre ellos)', async () => {
  ctx = { thirdParties: [], upsertCalls: [] };
  // reinvest_pct + tax_pct = 40 (no 100) — debe aceptarse, son independientes.
  const req = { body: basePayload({ reinvest_pct: 30, tax_pct: 10 }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.equal(res.statusCode, 200);
});

test('updateCommissionConfig: investor_team y commission_default_team se persisten como JSON.stringify (no "[object Object]")', async () => {
  ctx = {
    thirdParties: [{ id: 'owner-self' }, { id: 'mama' }],
    upsertCalls: [],
  };
  const req = { body: basePayload({
    commission_default_team: [{ thirdPartyId: 'mama', role: 'CERRADOR', sharePct: 100 }],
    investor_team: [
      { thirdPartyId: 'owner-self', sharePct: 50 },
      { thirdPartyId: 'mama', sharePct: 50 },
    ],
  }) };
  const res = mkRes();
  const next = mkNext();

  await settingsController.updateCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.equal(res.statusCode, 200);

  const teamCall = ctx.upsertCalls.find((c) => c.where.key === 'commission_default_team');
  const investorCall = ctx.upsertCalls.find((c) => c.where.key === 'investor_team');
  assert.ok(teamCall, 'esperaba un upsert de commission_default_team');
  assert.ok(investorCall, 'esperaba un upsert de investor_team');

  assert.equal(typeof teamCall.update.value, 'string');
  assert.equal(typeof investorCall.update.value, 'string');
  assert.deepEqual(JSON.parse(teamCall.update.value), [{ thirdPartyId: 'mama', role: 'CERRADOR', sharePct: 100 }]);
  assert.deepEqual(JSON.parse(investorCall.update.value), [
    { thirdPartyId: 'owner-self', sharePct: 50 },
    { thirdPartyId: 'mama', sharePct: 50 },
  ]);
});

test('getCommissionConfig: parsea investor_team y lo hidrata en investor_team_people (espejo de commission_default_team_people)', async () => {
  ctx = {
    thirdParties: [{ id: 'owner-self', name: 'Dueño' }, { id: 'mama', name: 'Mamá' }],
    upsertCalls: [],
    settingRows: [
      { key: 'investor_team', value: JSON.stringify([
        { thirdPartyId: 'owner-self', sharePct: 50 },
        { thirdPartyId: 'mama', sharePct: 50 },
      ]) },
      { key: 'commission_gross_pct', value: '10' },
      { key: 'reinvest_pct', value: '30' },
      { key: 'tax_pct', value: '10' },
    ],
  };
  const req = {};
  const res = mkRes();
  const next = mkNext();

  await settingsController.getCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.deepEqual(res.body.investor_team, [
    { thirdPartyId: 'owner-self', sharePct: 50 },
    { thirdPartyId: 'mama', sharePct: 50 },
  ]);
  assert.deepEqual(res.body.investor_team_people, [
    { id: 'owner-self', name: 'Dueño' },
    { id: 'mama', name: 'Mamá' },
  ]);
  assert.equal(res.body.commission_gross_pct, '10');
  assert.equal(res.body.reinvest_pct, '30');
  assert.equal(res.body.tax_pct, '10');
});

test('getCommissionConfig: investor_team ausente/corrupto → [] defensivo (no revienta)', async () => {
  ctx = { thirdParties: [], upsertCalls: [], settingRows: [{ key: 'investor_team', value: 'no-es-json' }] };
  const req = {};
  const res = mkRes();
  const next = mkNext();

  await settingsController.getCommissionConfig(req, res, next);

  assert.deepEqual(next.calls, []);
  assert.deepEqual(res.body.investor_team, []);
  assert.deepEqual(res.body.investor_team_people, []);
});
