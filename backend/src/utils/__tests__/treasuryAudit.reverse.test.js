const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeTreasuryAudit, VALID_ENTITIES, VALID_ACTIONS } = require('../treasuryAudit');

test('VALID_ACTIONS incluye REVERSE', () => {
  assert.ok(VALID_ACTIONS.includes('REVERSE'));
});

test('VALID_ENTITIES incluye LOAN, LOAN_PAYMENT, DEBT_PAYMENT, CASH_COUNT', () => {
  for (const e of ['LOAN', 'LOAN_PAYMENT', 'DEBT_PAYMENT', 'CASH_COUNT']) {
    assert.ok(VALID_ENTITIES.includes(e), `falta ${e}`);
  }
});

test('writeTreasuryAudit acepta REVERSE sobre LOAN sin lanzar', async () => {
  const calls = [];
  const fakeTx = { treasuryAuditLog: { create: async ({ data }) => { calls.push(data); return data; } } };
  await writeTreasuryAudit(fakeTx, {
    entityType: 'LOAN', entityId: 'loan-1', userId: 'u-1', action: 'REVERSE', reason: 'doble cobro corregido',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'REVERSE');
  assert.equal(calls[0].entityType, 'LOAN');
});
