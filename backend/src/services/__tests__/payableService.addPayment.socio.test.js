'use strict';
// addPayment — enrutamiento a cuenta socio (FASE B). Mismo patrón de
// reemplazo del módulo `../../config/database` (y stubs de txLocks,
// treasuryAudit, accountService) que saleService.cancel.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { payable, socioAccount } fijado por test
const created = []; // transacciones creadas dentro de la tx
let paymentRow = null;

const tx = {
  payable: {
    findUnique: async () => ctx.payable,
    update: async ({ data }) => ({ ...ctx.payable, ...data, payments: [] }),
  },
  account: {
    findFirst: async ({ where }) =>
      where.type === 'SOCIO' && where.thirdPartyId === ctx.payable.thirdPartyId && where.isActive
        ? ctx.socioAccount
        : null,
  },
  transaction: {
    create: async ({ data }) => {
      const row = { id: `tx-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  },
  payablePayment: {
    create: async ({ data }) => {
      paymentRow = { id: 'pp-1', ...data };
      return paymentRow;
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
  paymentRow = null;
  ctx = {
    payable: {
      id: 'pay-1', type: 'PARTNER_SHARE', status: 'PENDING',
      totalAmount: 6_400_000, paidAmount: 0, vehicleId: 'veh-1',
      thirdPartyId: 'tp-socio', description: 'Ganancia socio venta ABC',
      vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: { id: 'tp-socio', name: 'Mamá' },
    },
    socioAccount: { id: 'acc-socio', type: 'SOCIO', thirdPartyId: 'tp-socio', isActive: true },
    ...over,
  };
}

test('PARTNER_SHARE a tercero con cuenta socio → crea egreso empresa + ingreso socio; pago liga el egreso', async () => {
  resetCtx();
  const result = await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );

  assert.equal(created.length, 2);
  const egreso = created.find((t) => t.type === 'EXPENSE');
  const ingreso = created.find((t) => t.type === 'INCOME');
  assert.equal(egreso.accountId, 'acc-empresa');
  assert.equal(egreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(ingreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.amount, 6_400_000);

  // PayablePayment liga el EGRESO (el que salda la CxP), no el ingreso.
  assert.equal(paymentRow.transactionId, egreso.id);
  assert.equal(result.transaction.type, 'EXPENSE');
});

test('tercero SIN cuenta socio → un solo egreso (sin ingreso)', async () => {
  resetCtx({ socioAccount: null });
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'EXPENSE');
});

test('cuenta origen === cuenta socio destino → 400', async () => {
  resetCtx();
  await assert.rejects(
    () => payableService.addPayment(
      'pay-1', { accountId: 'acc-socio', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
    ),
    (e) => e.statusCode === 400 && /socio/i.test(e.message),
  );
});

test('CAPITAL_RETURN a socio con cuenta → egreso empresa + ingreso socio, categoría CAPITAL_RETURN', async () => {
  resetCtx();
  ctx.payable.type = 'CAPITAL_RETURN';
  ctx.payable.description = 'Devolución de capital socio ABC';
  const result = await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );
  assert.equal(created.length, 2);
  const egreso = created.find((t) => t.type === 'EXPENSE');
  const ingreso = created.find((t) => t.type === 'INCOME');
  assert.equal(egreso.category, 'CAPITAL_RETURN');
  assert.equal(ingreso.category, 'CAPITAL_RETURN');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(result.transaction.type, 'EXPENSE');
});
