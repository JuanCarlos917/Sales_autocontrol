'use strict';
// getSocioPending — pendientes de socio: ganancia por pagar (PARTNER_SHARE) y
// comisión por cobrar (RECEIVABLE con prefijo "Comisión socio venta"). Mismo
// patrón de reemplazo del módulo `../../config/database` que saleService.cancel.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let rows; // fixtures fijados por test

const startsWith = (value, filter) =>
  typeof filter?.startsWith === 'string' && (value || '').startsWith(filter.startsWith);
const statusMatch = (value, filter) =>
  filter && Array.isArray(filter.in) ? filter.in.includes(value) : value === filter;

const fakePrisma = {
  payable: {
    findMany: async ({ where }) =>
      rows.filter(
        (p) =>
          p.type === where.type &&
          statusMatch(p.status, where.status) &&
          (where.description ? startsWith(p.description, where.description) : true),
      ),
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const payableService = require('../payableService');

const mkRow = (over) => ({
  id: 'p', type: 'PARTNER_SHARE', status: 'PENDING',
  totalAmount: 1_000_000, paidAmount: 0, vehicleId: 'v1',
  vehicle: { id: 'v1', plate: 'ABC', brand: 'Mazda', model: '3' },
  thirdParty: { id: 'tp', name: 'Mamá' }, description: 'Ganancia socio venta ABC',
  ...over,
});

test('separa ganancia (PARTNER_SHARE) y comisión (RECEIVABLE prefijo socio) en dos buckets', async () => {
  rows = [
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 6_400_000, paidAmount: 0 }),
    mkRow({ id: 'c1', type: 'RECEIVABLE', description: 'Comisión socio venta ABC', totalAmount: 1_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.profit.count, 1);
  assert.equal(out.profit.items[0].id, 'g1');
  assert.equal(out.profit.total, 6_400_000);
  assert.equal(out.commission.count, 1);
  assert.equal(out.commission.items[0].id, 'c1');
  assert.equal(out.commission.total, 1_000_000);
});

test('excluye la CxC de venta ("Venta vehículo") del bucket de comisión', async () => {
  rows = [
    mkRow({ id: 'sale', type: 'RECEIVABLE', description: 'Venta vehículo ABC', totalAmount: 5_000_000, paidAmount: 0 }),
    mkRow({ id: 'c1', type: 'RECEIVABLE', description: 'Comisión socio venta ABC', totalAmount: 1_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.commission.count, 1);
  assert.equal(out.commission.items[0].id, 'c1');
});

test('pending = totalAmount - paidAmount; total = suma de pendings', async () => {
  rows = [
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 6_400_000, paidAmount: 400_000 }),
    mkRow({ id: 'g2', type: 'PARTNER_SHARE', totalAmount: 2_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.profit.items[0].pending, 6_000_000);
  assert.equal(out.profit.total, 8_000_000);
});

test('buckets vacíos → { total:0, count:0, items:[] }', async () => {
  rows = [];
  const out = await payableService.getSocioPending();
  assert.deepEqual(out.profit, { total: 0, count: 0, items: [] });
  assert.deepEqual(out.commission, { total: 0, count: 0, items: [] });
});

test('incluye bucket capital con las CxP CAPITAL_RETURN pendientes', async () => {
  rows = [
    mkRow({ id: 'cap1', type: 'CAPITAL_RETURN', description: 'Devolución de capital socio ABC', totalAmount: 30_000_000, paidAmount: 0 }),
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 12_800_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.capital.count, 1);
  assert.equal(out.capital.items[0].id, 'cap1');
  assert.equal(out.capital.total, 30_000_000);
});
