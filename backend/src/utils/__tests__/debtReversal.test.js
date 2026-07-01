const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tierStatus, recomputeDebtFromPayments } = require('../debtReversal');

const debt = {
  totalAmount: '1000',
  installments: [
    { id: 'i1', sequence: 1, plannedAmount: '500' },
    { id: 'i2', sequence: 2, plannedAmount: '500' },
  ],
};

test('tierStatus: 0→PENDING, parcial→PARTIAL, completo→PAID', () => {
  assert.equal(tierStatus(500, 0), 'PENDING');
  assert.equal(tierStatus(500, 200), 'PARTIAL');
  assert.equal(tierStatus(500, 500), 'PAID');
});

test('recompute sin pagos vivos: cero, cuotas PENDING', () => {
  const r = recomputeDebtFromPayments(debt, []);
  assert.equal(r.paidAmount, 0);
  assert.equal(r.status, 'PENDING');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 0, status: 'PENDING' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con un pago de 500: 1ª cuota PAID, 2ª PENDING, crédito PARTIAL', () => {
  const r = recomputeDebtFromPayments(debt, [{ amount: '500' }]);
  assert.equal(r.paidAmount, 500);
  assert.equal(r.status, 'PARTIAL');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con pagos que cubren todo: crédito PAID, cuotas PAID', () => {
  const r = recomputeDebtFromPayments(debt, [{ amount: '600' }, { amount: '400' }]);
  assert.equal(r.paidAmount, 1000);
  assert.equal(r.status, 'PAID');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 500, status: 'PAID' },
  ]);
});
