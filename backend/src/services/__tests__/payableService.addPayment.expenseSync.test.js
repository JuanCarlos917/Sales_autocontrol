'use strict';
// addPayment — sincroniza expense.paid cuando la CxP está ligada a un gasto.
// Mismo patrón de stubs que payableService.addPayment.socio.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx;                 // { payable } fijado por test
const created = [];      // transacciones creadas
let expenseUpdate = null; // { where, data } de tx.expense.update

const tx = {
  payable: {
    findUnique: async () => ctx.payable,
    update: async ({ data }) => ({ ...ctx.payable, ...data, payments: [] }),
  },
  account: { findFirst: async () => null },
  transaction: {
    create: async ({ data }) => {
      const row = { id: `tx-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  },
  payablePayment: { create: async ({ data }) => ({ id: 'pp-1', ...data }) },
  expense: {
    update: async ({ where, data }) => {
      expenseUpdate = { where, data };
      return { id: where.id, ...data };
    },
  },
};

const fakePrisma = {
  account: { findUnique: async () => ({ id: 'acc-empresa', isActive: true }) },
  $transaction: async (fn) => fn(tx),
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const locksPath = require.resolve('../../utils/txLocks');
require.cache[locksPath] = {
  id: locksPath, filename: locksPath, loaded: true,
  exports: { lockRow: async () => {} },
};

const auditPath = require.resolve('../../utils/treasuryAudit');
require.cache[auditPath] = {
  id: auditPath, filename: auditPath, loaded: true,
  exports: { writeTreasuryAudit: async () => {}, snapshotEntity: (x) => x },
};

const acctPath = require.resolve('../accountService');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: { calculateBalance: async () => 1_000_000_000 },
};

const payableService = require('../payableService');

function resetCtx(over = {}) {
  created.length = 0;
  expenseUpdate = null;
  ctx = {
    payable: {
      id: 'pay-1', type: 'PAYABLE', status: 'PENDING',
      totalAmount: 500_000, paidAmount: 0, vehicleId: 'veh-1',
      thirdPartyId: null, expenseId: 'exp-1', description: 'Gasto MECANICA - ABC',
      vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: null,
    },
    ...over,
  };
}

test('pago total de CxP ligada a gasto → expense.paid = true', async () => {
  resetCtx();
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 500_000, date: '2026-08-19' }, 'user-1',
  );
  assert.ok(expenseUpdate, 'debió actualizar el gasto');
  assert.equal(expenseUpdate.where.id, 'exp-1');
  assert.equal(expenseUpdate.data.paid, true);
});

test('pago parcial de CxP ligada a gasto → expense.paid = false', async () => {
  resetCtx();
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 200_000, date: '2026-08-19' }, 'user-1',
  );
  assert.ok(expenseUpdate, 'debió actualizar el gasto (parcial)');
  assert.equal(expenseUpdate.data.paid, false);
});

test('CxP sin expenseId (p.ej. compra) → no toca ningún gasto', async () => {
  resetCtx({ payable: {
    id: 'pay-2', type: 'PAYABLE', status: 'PENDING',
    totalAmount: 500_000, paidAmount: 0, vehicleId: 'veh-1',
    thirdPartyId: null, expenseId: null, description: 'Compra ABC',
    vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: null,
  } });
  await payableService.addPayment(
    'pay-2', { accountId: 'acc-empresa', amount: 500_000, date: '2026-08-19' }, 'user-1',
  );
  assert.equal(expenseUpdate, null, 'no debió tocar ningún gasto');
});
