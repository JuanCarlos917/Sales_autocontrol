'use strict';
// getAll(overdue) — el filtro de vencidos debe excluir las CANCELLED (además de PAID).
// Bug: usaba { not: 'PAID' }, que dejaba pasar canceladas y las mostraba como vencidas.
// Mismo patrón de reemplazo de módulo `../../config/database` que otros tests del servicio.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let capturedWhere = null;

const fakePrisma = {
  payable: {
    findMany: async ({ where }) => {
      capturedWhere = where;
      return [];
    },
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const payableService = require('../payableService');

test('overdue=true filtra por dueDate < ahora y status in [PENDING, PARTIAL] (excluye CANCELLED)', async () => {
  capturedWhere = null;
  await payableService.getAll({ overdue: true });
  assert.deepEqual(capturedWhere.status, { in: ['PENDING', 'PARTIAL'] });
  assert.ok(capturedWhere.dueDate && capturedWhere.dueDate.lt instanceof Date);
});

test('overdue=true NO usa { not: PAID } (dejaría pasar canceladas)', async () => {
  capturedWhere = null;
  await payableService.getAll({ overdue: true });
  assert.notDeepEqual(capturedWhere.status, { not: 'PAID' });
});

test('sin overdue no fuerza ningún status', async () => {
  capturedWhere = null;
  await payableService.getAll({});
  assert.equal(capturedWhere.status, undefined);
});

test('un status explícito se respeta cuando no es overdue', async () => {
  capturedWhere = null;
  await payableService.getAll({ status: 'CANCELLED' });
  assert.equal(capturedWhere.status, 'CANCELLED');
});
