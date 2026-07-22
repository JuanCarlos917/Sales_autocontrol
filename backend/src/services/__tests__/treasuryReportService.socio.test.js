'use strict';
// treasuryReportService — los sumarios brutos (mensual / flujo) NO deben
// contar movimientos de cuentas SOCIO (capital del socio, no flujo de la
// empresa). FASE B introduce ingresos a cuentas SOCIO al pagar ganancias.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let groupByWhere = null;
let findManyWhere = null;

const fakePrisma = {
  transaction: {
    groupBy: async ({ where }) => { groupByWhere = where; return []; },
    findMany: async ({ where }) => { findManyWhere = where; return []; },
  },
  setting: { findUnique: async () => null },
  vehicle: {
    findMany: async () => [],
    findUnique: async () => ({ id: 'veh-1', plate: 'ABC123', brand: 'Test', model: 'X', purchasePrice: 0, salePrice: 0 }),
  },
  expense: { aggregate: async () => ({ _sum: { amount: 0 } }) },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

// accountService.findAll lo usa getDashboard para totalBalance; stub simple.
const acctPath = require.resolve('../accountService');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: { findAll: async () => [], getTotalBalance: async () => 0 },
};

const svc = require('../treasuryReportService');

test('getDashboard: el groupBy mensual excluye cuentas type SOCIO', async () => {
  await svc.getDashboard();
  assert.deepEqual(groupByWhere.account, { type: { not: 'SOCIO' } });
});

test('getCashFlow: el findMany del período excluye cuentas type SOCIO', async () => {
  await svc.getCashFlow({ period: 'week' });
  assert.deepEqual(findManyWhere.account, { type: { not: 'SOCIO' } });
});

test('getVehicleTransactions: el findMany por vehículo excluye cuentas type SOCIO', async () => {
  await svc.getVehicleTransactions('veh-1');
  assert.deepEqual(findManyWhere.account, { type: { not: 'SOCIO' } });
  assert.equal(findManyWhere.vehicleId, 'veh-1');
});
