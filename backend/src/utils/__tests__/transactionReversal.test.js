const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getReversibilityError,
  buildReversalData,
  MANUAL_REVERSAL,
  flipType,
  buildReversalDataMany,
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

test('flipType invierte los cuatro tipos', () => {
  assert.equal(flipType('INCOME'), 'EXPENSE');
  assert.equal(flipType('EXPENSE'), 'INCOME');
  assert.equal(flipType('TRANSFER_IN'), 'TRANSFER_OUT');
  assert.equal(flipType('TRANSFER_OUT'), 'TRANSFER_IN');
});

test('flipType lanza para tipo no reversable', () => {
  assert.throws(() => flipType('OTRO'), /no reversable/);
});

test('buildReversalData usa la categoría dada', () => {
  const original = { id: 'tx-abc123', accountId: 'acc-1', type: 'EXPENSE', amount: '1000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'u-1', 'motivo suficiente', 'LOAN_REVERSAL');
  assert.equal(data.category, 'LOAN_REVERSAL');
  assert.equal(data.type, 'INCOME');
  assert.equal(data.reversesTransactionId, 'tx-abc123');
});

test('buildReversalData por defecto es MANUAL_REVERSAL', () => {
  const original = { id: 'tx-1', accountId: 'acc-1', type: 'INCOME', amount: '1000', vehicleId: null, thirdPartyId: null };
  assert.equal(buildReversalData(original, 'u-1', 'motivo suficiente').category, MANUAL_REVERSAL);
});

test('buildReversalDataMany genera un compensatorio por fuente', () => {
  const sources = [
    { id: 'a', accountId: 'acc-1', type: 'EXPENSE', amount: '500', vehicleId: null, thirdPartyId: null },
    { id: 'b', accountId: 'acc-1', type: 'INCOME', amount: '300', vehicleId: null, thirdPartyId: null },
  ];
  const out = buildReversalDataMany(sources, 'u-1', 'anulación completa', 'LOAN_REVERSAL');
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'INCOME');
  assert.equal(out[1].type, 'EXPENSE');
  assert.ok(out.every((d) => d.category === 'LOAN_REVERSAL'));
});
