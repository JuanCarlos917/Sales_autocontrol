const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getReversibilityError,
  buildReversalData,
  MANUAL_REVERSAL,
} = require('../transactionReversal');

const manualIncome = {
  type: 'INCOME',
  expenseId: null,
  loanId: null,
  loanPaymentId: null,
  debtId: null,
  transferId: null,
  reversesTransactionId: null,
  hasPayablePayment: false,
  alreadyReversed: false,
};

test('getReversibilityError: movimiento manual es reversable (null)', () => {
  assert.equal(getReversibilityError(manualIncome), null);
});

test('getReversibilityError: ligado a gasto → 403', () => {
  const err = getReversibilityError({ ...manualIncome, expenseId: 'exp1' });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ligado a préstamo → 403', () => {
  const err = getReversibilityError({ ...manualIncome, loanPaymentId: 'lp1' });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ligado a pago de payable → 403', () => {
  const err = getReversibilityError({ ...manualIncome, hasPayablePayment: true });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ya reversado → 409', () => {
  const err = getReversibilityError({ ...manualIncome, alreadyReversed: true });
  assert.equal(err.status, 409);
});

test('getReversibilityError: es a su vez un reverso → 400', () => {
  const err = getReversibilityError({ ...manualIncome, reversesTransactionId: 'orig1' });
  assert.equal(err.status, 400);
});

test('getReversibilityError: tipo no INCOME/EXPENSE → 403', () => {
  const err = getReversibilityError({ ...manualIncome, type: 'TRANSFER_IN' });
  assert.equal(err.status, 403);
});

test('buildReversalData: invierte INCOME a EXPENSE y conserva monto/cuenta', () => {
  const original = { id: 'ckabcdef123456', accountId: 'acc1', type: 'INCOME', amount: '50000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'user1', 'corrección de monto erróneo');
  assert.equal(data.type, 'EXPENSE');
  assert.equal(data.amount, '50000');
  assert.equal(data.accountId, 'acc1');
  assert.equal(data.category, MANUAL_REVERSAL);
  assert.equal(data.reversesTransactionId, 'ckabcdef123456');
  assert.equal(data.createdBy, 'user1');
  assert.match(data.description, /#123456/);
  assert.match(data.description, /corrección de monto erróneo/);
});

test('buildReversalData: invierte EXPENSE a INCOME', () => {
  const original = { id: 'x000001', accountId: 'acc1', type: 'EXPENSE', amount: '10000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'user1', 'motivo suficientemente largo');
  assert.equal(data.type, 'INCOME');
});
