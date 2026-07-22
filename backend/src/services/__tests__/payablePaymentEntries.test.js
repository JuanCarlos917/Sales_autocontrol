'use strict';
// buildPaymentTransactions — helper puro que decide los asientos de un pago.
// FASE B: un pago de PARTNER_SHARE/COMMISSION a un tercero con cuenta SOCIO
// activa genera EGRESO (empresa) + INGRESO (socio) con la MISMA categoría.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentTransactions } = require('../payablePaymentEntries');
const { AppError } = require('../../middleware/errorHandler');

const base = (over = {}) => ({
  transactionType: 'EXPENSE',
  transactionCategory: 'PARTNER_SHARE',
  accountId: 'acc-empresa',
  socioAccount: { id: 'acc-socio' },
  isReceivable: false,
  paymentAmount: 6_400_000,
  description: null,
  payableDescription: 'Ganancia socio venta ABC123',
  date: new Date('2026-07-21T12:00:00'),
  vehicleId: 'veh-1',
  thirdPartyId: 'tp-socio',
  userId: 'user-1',
  ...over,
});

test('PARTNER_SHARE con cuenta socio → EGRESO empresa + INGRESO socio, misma categoría', () => {
  const { entries, paymentTransactionIndex } = buildPaymentTransactions(base());
  assert.equal(entries.length, 2);
  assert.equal(paymentTransactionIndex, 0);

  const [egreso, ingreso] = entries;
  assert.equal(egreso.type, 'EXPENSE');
  assert.equal(egreso.accountId, 'acc-empresa');
  assert.equal(egreso.category, 'PARTNER_SHARE');
  assert.equal(egreso.amount, 6_400_000);

  assert.equal(ingreso.type, 'INCOME');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(ingreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.amount, 6_400_000);
  assert.match(ingreso.description, /cuenta socio/i);
});

test('COMMISSION con cuenta socio → categoría COMMISSION en ambos asientos', () => {
  const { entries } = buildPaymentTransactions(base({ transactionCategory: 'COMMISSION' }));
  assert.equal(entries[0].category, 'COMMISSION');
  assert.equal(entries[1].category, 'COMMISSION');
});

test('sin cuenta socio → un solo asiento (comportamiento actual)', () => {
  const { entries, paymentTransactionIndex } = buildPaymentTransactions(base({ socioAccount: null }));
  assert.equal(entries.length, 1);
  assert.equal(paymentTransactionIndex, 0);
  assert.equal(entries[0].type, 'EXPENSE');
  assert.equal(entries[0].accountId, 'acc-empresa');
});

test('RECEIVABLE nunca enruta (aunque haya cuenta socio) → un solo INGRESO a la empresa', () => {
  const { entries } = buildPaymentTransactions(base({
    isReceivable: true, transactionType: 'INCOME', transactionCategory: 'OTHER_INCOME',
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'INCOME');
  assert.equal(entries[0].accountId, 'acc-empresa');
});

test('cuenta origen === cuenta socio destino → AppError 400', () => {
  assert.throws(
    () => buildPaymentTransactions(base({ accountId: 'acc-socio' })),
    (e) => e instanceof AppError && e.statusCode === 400 && /socio/i.test(e.message),
  );
});

test('conservación: egreso e ingreso mueven el mismo monto (neto empresa+socio = 0)', () => {
  const { entries } = buildPaymentTransactions(base());
  const delta = entries.reduce((s, e) => s + (e.type === 'INCOME' ? e.amount : -e.amount), 0);
  assert.equal(delta, 0);
});

test('description explícita se respeta y el ingreso la prefija', () => {
  const { entries } = buildPaymentTransactions(base({ description: 'Pago mano' }));
  assert.equal(entries[0].description, 'Pago mano');
  assert.equal(entries[1].description, 'Entrada a cuenta socio — Pago mano');
});
