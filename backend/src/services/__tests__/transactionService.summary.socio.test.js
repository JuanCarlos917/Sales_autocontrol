'use strict';
// transactionService.getSummary — la vista agregada (sin accountId) NO debe
// contar movimientos de cuentas SOCIO (capital del socio, no flujo de la
// empresa). Si se pide una cuenta puntual (incluida una SOCIO), se respeta.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let findManyWhere = null;

const fakePrisma = {
  transaction: {
    findMany: async ({ where }) => { findManyWhere = where; return []; },
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const svc = require('../transactionService');

test('getSummary({}) sin accountId: excluye cuentas type SOCIO', async () => {
  await svc.getSummary({});
  assert.deepEqual(findManyWhere.account, { type: { not: 'SOCIO' } });
});

test('getSummary({ accountId }) con cuenta puntual: no excluye SOCIO y respeta accountId', async () => {
  await svc.getSummary({ accountId: 'acc-x' });
  assert.equal(findManyWhere.account, undefined);
  assert.equal(findManyWhere.accountId, 'acc-x');
});
