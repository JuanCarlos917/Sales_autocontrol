'use strict';
// ═══════════════════════════════════════════════════════════════
// Unit tests — reversalEngine.applyReversal
//
// No DB required: all Prisma calls are replaced by a fake client
// injected via the optional `client` param. writeTreasuryAudit
// runs for real against fakeTx.treasuryAuditLog.create.
// ═══════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyReversal, ALREADY_REVERSED } = require('../reversalEngine');

// Valid source shapes that buildReversalDataMany can flip
const SOURCE_1 = { id: 'tx-1', accountId: 'acc-1', type: 'INCOME',  amount: '1000', vehicleId: null, thirdPartyId: null };
const SOURCE_2 = { id: 'tx-2', accountId: 'acc-1', type: 'EXPENSE', amount: '500',  vehicleId: null, thirdPartyId: null };

// Helper: builds a fresh fake client + tx for each test
function makeClient({ createImpl } = {}) {
  const auditCalls = [];
  let n = 0;
  const fakeTx = {
    transaction: {
      create: createImpl ?? (async ({ data }) => ({ id: 'comp-' + (++n), ...data })),
    },
    treasuryAuditLog: {
      create: async ({ data }) => { auditCalls.push(data); return data; },
    },
    _auditCalls: auditCalls,
    _getN: () => n,
  };
  const client = {
    $transaction: async (fn) => fn(fakeTx),
    _fakeTx: fakeTx,
    _auditCalls: auditCalls,
  };
  return client;
}

// ── 1. Empty sources ─────────────────────────────────────────────
test('applyReversal: sources vacío lanza AppError 400 sin llamar a create', async () => {
  const client = makeClient();
  let createCalled = false;
  client._fakeTx.transaction.create = async () => { createCalled = true; };

  await assert.rejects(
    () => applyReversal({
      sources: [],
      reason: 'test',
      userId: 'u-1',
      category: 'MANUAL_REVERSAL',
      auditEntityType: 'TRANSACTION',
      auditEntityId: 'tx-1',
      client,
    }),
    (err) => {
      assert.equal(err.statusCode, 400, 'debe ser 400');
      assert.ok(err.isOperational, 'debe ser AppError operacional');
      return true;
    }
  );
  assert.equal(createCalled, false, 'create no debe llamarse');
});

// ── 1b. Non-array sources ────────────────────────────────────────
test('applyReversal: sources null lanza AppError 400', async () => {
  const client = makeClient();
  await assert.rejects(
    () => applyReversal({
      sources: null,
      reason: 'test',
      userId: 'u-1',
      category: 'MANUAL_REVERSAL',
      auditEntityType: 'TRANSACTION',
      auditEntityId: 'tx-1',
      client,
    }),
    (err) => { assert.equal(err.statusCode, 400); return true; }
  );
});

// ── 2. Happy path: 2 sources ─────────────────────────────────────
test('applyReversal: dos fuentes → 2 creates y 1 entrada audit con REVERSE', async () => {
  const auditCalls = [];
  let n = 0;
  const fakeTx = {
    transaction: { create: async ({ data }) => ({ id: 'comp-' + (++n), ...data }) },
    treasuryAuditLog: { create: async ({ data }) => { auditCalls.push(data); return data; } },
  };
  const client = { $transaction: async (fn) => fn(fakeTx) };

  const result = await applyReversal({
    sources: [SOURCE_1, SOURCE_2],
    reason: 'anulación de prueba',
    userId: 'u-1',
    category: 'MANUAL_REVERSAL',
    auditEntityType: 'TRANSACTION',
    auditEntityId: 'tx-1',
    client,
  });

  assert.equal(result.length, 2, 'devuelve 2 compensatorios');
  assert.equal(n, 2, 'exactamente 2 creates');
  assert.equal(auditCalls.length, 1, 'exactamente 1 entrada audit');
  assert.equal(auditCalls[0].action, 'REVERSE');
  assert.equal(auditCalls[0].entityType, 'TRANSACTION');
  assert.equal(auditCalls[0].entityId, 'tx-1');
  assert.equal(auditCalls[0].after.count, 2);
});

// ── 3. Unique constraint race → AppError 409 ─────────────────────
test('applyReversal: P2002 en create → AppError 409 con mensaje ALREADY_REVERSED', async () => {
  const fakeTx = {
    transaction: {
      create: async () => {
        const e = new Error('unique constraint');
        e.code = 'P2002';
        throw e;
      },
    },
    treasuryAuditLog: { create: async () => {} },
  };
  const client = { $transaction: async (fn) => fn(fakeTx) };

  await assert.rejects(
    () => applyReversal({
      sources: [SOURCE_1],
      reason: 'x',
      userId: 'u-1',
      category: 'MANUAL_REVERSAL',
      auditEntityType: 'TRANSACTION',
      auditEntityId: 'tx-1',
      client,
    }),
    (err) => {
      assert.equal(err.statusCode, 409, 'debe ser 409');
      assert.equal(err.message, ALREADY_REVERSED, 'mensaje == ALREADY_REVERSED');
      return true;
    }
  );
});

// ── 4. Generic error re-thrown unchanged ─────────────────────────
test('applyReversal: error genérico se relanza sin mapear a 409', async () => {
  const boom = new Error('boom');
  const fakeTx = {
    transaction: { create: async () => { throw boom; } },
    treasuryAuditLog: { create: async () => {} },
  };
  const client = { $transaction: async (fn) => fn(fakeTx) };

  await assert.rejects(
    () => applyReversal({
      sources: [SOURCE_1],
      reason: 'x',
      userId: 'u-1',
      category: 'MANUAL_REVERSAL',
      auditEntityType: 'TRANSACTION',
      auditEntityId: 'tx-1',
      client,
    }),
    (err) => { assert.strictEqual(err, boom, 'debe ser el mismo error'); return true; }
  );
});

// ═════════════════════════════════════════════════════════════
// applyReversalInTx tests: núcleo sin transacción abierta
// ═════════════════════════════════════════════════════════════

const { applyReversalInTx } = require('../reversalEngine');

test('applyReversalInTx: crea compensatorios y 1 audit usando el tx dado, sin abrir transacción', async () => {
  let n = 0;
  const auditCalls = [];
  const tx = {
    transaction: { create: async ({ data }) => ({ id: 'comp-' + (++n), ...data }) },
    treasuryAuditLog: { create: async ({ data }) => { auditCalls.push(data); return data; } },
  };
  const sources = [
    { id: 's1', accountId: 'a1', type: 'INCOME', amount: '100', vehicleId: null, thirdPartyId: null },
    { id: 's2', accountId: 'a1', type: 'INCOME', amount: '50',  vehicleId: null, thirdPartyId: null },
  ];
  const out = await applyReversalInTx(tx, {
    sources, reason: 'reverso de prueba xyz', userId: 'u1',
    category: 'LOAN_REVERSAL', auditEntityType: 'LOAN_PAYMENT', auditEntityId: 'pay-1',
  });
  assert.equal(out.length, 2);
  assert.equal(n, 2);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, 'REVERSE');
  assert.equal(auditCalls[0].entityType, 'LOAN_PAYMENT');
  assert.equal(auditCalls[0].entityId, 'pay-1');
  assert.ok(out.every((c) => c.category === 'LOAN_REVERSAL'));
});

test('applyReversalInTx: sources vacío lanza AppError 400 sin crear', async () => {
  let created = false;
  const tx = { transaction: { create: async () => { created = true; } }, treasuryAuditLog: { create: async () => {} } };
  await assert.rejects(
    () => applyReversalInTx(tx, { sources: [], reason: 'x'.repeat(10), userId: 'u', category: 'LOAN_REVERSAL', auditEntityType: 'LOAN', auditEntityId: 'l1' }),
    (err) => { assert.equal(err.statusCode, 400); return true; },
  );
  assert.equal(created, false);
});
