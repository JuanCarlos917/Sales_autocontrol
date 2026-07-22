// Desambiguación del receivable de la VENTA vs el de comisión del socio.
// Con socio, un vehículo puede tener DOS CxP tipo RECEIVABLE; getSaleSummary,
// addSaleCollection y cancelSale deben operar SOLO sobre la de la venta.
// Runner: node:test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSaleReceivable, SALE_RECEIVABLE_PREFIX } = require('../saleService');

test('isSaleReceivable: acepta la CxC de la venta', () => {
  assert.equal(isSaleReceivable({ type: 'RECEIVABLE', description: `${SALE_RECEIVABLE_PREFIX} ABC123` }), true);
});

test('isSaleReceivable: rechaza la CxC de comisión del socio', () => {
  assert.equal(isSaleReceivable({ type: 'RECEIVABLE', description: 'Comisión socio venta ABC123' }), false);
});

test('isSaleReceivable: rechaza otros tipos aunque el texto coincida', () => {
  assert.equal(isSaleReceivable({ type: 'PAYABLE', description: `${SALE_RECEIVABLE_PREFIX} ABC123` }), false);
});

test('isSaleReceivable: tolera description faltante', () => {
  assert.equal(isSaleReceivable({ type: 'RECEIVABLE', description: null }), false);
  assert.equal(isSaleReceivable({ type: 'RECEIVABLE' }), false);
});
