// Unit tests de investorController — verifican delegación en investorService
// (list/summary son pass-throughs finos, espejo de commissionController;
// el proyecto no tiene tests de integración HTTP para /commissions, así
// que aquí seguimos la misma altitud: mock del service + fake req/res).
// Runner: node:test (Node 18+), sin DB ni servidor Express real.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const investorController = require('../investorController');
const investorService = require('../../services/investorService');

function mkRes() {
  const res = { statusCode: 200, body: undefined };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('investorController.list: delega en investorService.listByVehicle con status del query', async (t) => {
  const calls = [];
  t.mock.method(investorService, 'listByVehicle', async (prismaOrTx, opts) => {
    calls.push(opts);
    return [{ vehicleId: 'v1' }];
  });

  const req = { query: { status: 'pending' } };
  const res = mkRes();
  const next = (err) => { throw err || new Error('next() no debería llamarse'); };

  await investorController.list(req, res, next);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { status: 'pending' });
  assert.deepEqual(res.body, [{ vehicleId: 'v1' }]);
});

test('investorController.list: sin status en el query, lo pasa como undefined', async (t) => {
  const calls = [];
  t.mock.method(investorService, 'listByVehicle', async (prismaOrTx, opts) => {
    calls.push(opts);
    return [];
  });

  const req = { query: {} };
  const res = mkRes();
  const next = (err) => { throw err || new Error('next() no debería llamarse'); };

  await investorController.list(req, res, next);

  assert.deepEqual(calls[0], { status: undefined });
  assert.deepEqual(res.body, []);
});

test('investorController.list: propaga errores del service a next()', async (t) => {
  t.mock.method(investorService, 'listByVehicle', async () => {
    throw new Error('boom');
  });

  const req = { query: {} };
  const res = mkRes();
  let caughtErr = null;
  const next = (err) => { caughtErr = err; };

  await investorController.list(req, res, next);

  assert.ok(caughtErr instanceof Error);
  assert.equal(caughtErr.message, 'boom');
});

test('investorController.summary: delega en investorService.getSummary y devuelve su resultado', async (t) => {
  const fakeSummary = { pendingTotal: 1_500_000, paidThisMonth: 700_000, byPerson: [] };
  t.mock.method(investorService, 'getSummary', async () => fakeSummary);

  const req = {};
  const res = mkRes();
  const next = (err) => { throw err || new Error('next() no debería llamarse'); };

  await investorController.summary(req, res, next);

  assert.deepEqual(res.body, fakeSummary);
});

test('investorController.summary: propaga errores del service a next()', async (t) => {
  t.mock.method(investorService, 'getSummary', async () => {
    throw new Error('db down');
  });

  const req = {};
  const res = mkRes();
  let caughtErr = null;
  const next = (err) => { caughtErr = err; };

  await investorController.summary(req, res, next);

  assert.ok(caughtErr instanceof Error);
  assert.equal(caughtErr.message, 'db down');
});
