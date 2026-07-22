'use strict';
// ═══════════════════════════════════════════════════════════════
// payableService.getSummary — PARTNER_SHARE (ganancia de socio) debe
// contar como pasivo real en "Total por pagar", igual que COMMISSION
// y PROFIT_SHARE (ver 0127a43 para el precedente de PROFIT_SHARE).
//
// Mismo patrón que saleService.cancel.test.js: se reemplaza el módulo
// `../config/database` en el require cache por un prisma falso.
// ═══════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');

let payablesFixture; // payables pendientes/parciales fijados por test

const matchesFilter = (value, filter) => {
  if (typeof filter === 'string') return value === filter;
  if (filter && Array.isArray(filter.in)) return filter.in.includes(value);
  return false;
};

const fakePrisma = {
  payable: {
    aggregate: async ({ where }) => {
      const matches = payablesFixture.filter(
        (p) => matchesFilter(p.type, where.type) && matchesFilter(p.status, where.status)
      );
      const totalAmount = matches.reduce((sum, p) => sum + p.totalAmount, 0);
      const paidAmount = matches.reduce((sum, p) => sum + p.paidAmount, 0);
      return {
        _sum: { totalAmount, paidAmount },
        _count: matches.length,
      };
    },
    count: async ({ where }) => {
      const matches = payablesFixture.filter(
        (p) =>
          matchesFilter(p.type, where.type) &&
          matchesFilter(p.status, where.status) &&
          (!where.dueDate || (p.dueDate && p.dueDate < where.dueDate.lt))
      );
      return matches.length;
    },
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const payableService = require('../payableService');

test('getSummary: una CxP PARTNER_SHARE pendiente cuenta en payables.total', async () => {
  payablesFixture = [
    { id: 'p-1', type: 'PARTNER_SHARE', status: 'PENDING', totalAmount: 1_000_000, paidAmount: 0 },
  ];

  const summary = await payableService.getSummary();

  assert.equal(summary.payables.total, 1_000_000);
  assert.equal(summary.payables.count, 1);
});

test('getSummary: PARTNER_SHARE + PAYABLE + COMMISSION + PROFIT_SHARE se suman todas en payables.total', async () => {
  payablesFixture = [
    { id: 'p-1', type: 'PAYABLE', status: 'PENDING', totalAmount: 500_000, paidAmount: 0 },
    { id: 'p-2', type: 'COMMISSION', status: 'PENDING', totalAmount: 200_000, paidAmount: 0 },
    { id: 'p-3', type: 'PROFIT_SHARE', status: 'PARTIAL', totalAmount: 300_000, paidAmount: 100_000 },
    { id: 'p-4', type: 'PARTNER_SHARE', status: 'PENDING', totalAmount: 400_000, paidAmount: 0 },
    { id: 'p-5', type: 'RECEIVABLE', status: 'PENDING', totalAmount: 999_999, paidAmount: 0 },
  ];

  const summary = await payableService.getSummary();

  // 500k + 200k + (300k-100k) + 400k = 1.3M — RECEIVABLE nunca cuenta en payables.
  assert.equal(summary.payables.total, 1_300_000);
  assert.equal(summary.payables.count, 4);
});
