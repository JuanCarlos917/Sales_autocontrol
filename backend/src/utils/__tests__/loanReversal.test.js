const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tierStatus, recomputeLoanFromPayments } = require('../loanReversal');

const loan = {
  principalAmount: '1000',
  interestAmount: '0',
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

test('recompute sin pagos vivos: todo en cero, cuotas PENDING', () => {
  const r = recomputeLoanFromPayments(loan, []);
  assert.equal(r.paidAmount, 0);
  assert.equal(r.interestReceived, 0);
  assert.equal(r.extraReceived, 0);
  assert.equal(r.status, 'PENDING');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 0, status: 'PENDING' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con un pago parcial de 500: 1ª cuota PAID, 2ª PENDING, préstamo PARTIAL', () => {
  const r = recomputeLoanFromPayments(loan, [
    { principalAmount: '500', interestPortion: '0', extraAmount: '0' },
  ]);
  assert.equal(r.paidAmount, 500);
  assert.equal(r.status, 'PARTIAL');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con pagos que cubren todo: préstamo PAID, cuotas PAID, suma interés/extra', () => {
  const r = recomputeLoanFromPayments(loan, [
    { principalAmount: '600', interestPortion: '0', extraAmount: '10' },
    { principalAmount: '400', interestPortion: '0', extraAmount: '5' },
  ]);
  assert.equal(r.paidAmount, 1000);
  assert.equal(r.extraReceived, 15);
  assert.equal(r.status, 'PAID');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 500, status: 'PAID' },
  ]);
});
