'use strict';
// vehicleService — pin del wiring Setting → calculateVehicleMetrics(targetMarginDefault).
//
// El E2E de precio objetivo usa el margen global por defecto (15%), que es
// numéricamente idéntico a DEFAULT_TARGET_MARGIN en financial.js. Eso significa
// que si alguien elimina el 4to argumento en una llamada a calculateVehicleMetrics
// (o vuelve a hardcodear el fallback 0.15 en vez de usar el Setting real), el
// E2E se queda en verde igual — no hay señal.
//
// Este test usa un margen NO-default (0.30) para que cualquier caída al
// fallback hardcodeado produzca un resultado numéricamente distinto y el test
// falle. Mismo patrón de mock que dashboardService.pipelineTarget.test.js:
// se reemplaza `../config/database` en el require cache por un prisma falso.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const vehicleFixture = {
  id: 'veh-1',
  userId: 'user-1',
  plate: 'ABC123',
  purchasePrice: 20_000_000,
  listedPrice: 30_000_000,
  salePrice: null,
  stage: 'DISPONIBLE',
  targetMargin: null, // sin override → usa el margen global del Setting
  participation: 1,
  partnerContribution: 0,
  fromTradeIn: false,
  sourceVehicleId: null,
  tradeInsReceived: [],
  expenses: [],
  documents: [],
  publishedPortals: [],
};

const fakePrisma = {
  vehicle: {
    findFirst: async () => vehicleFixture,
  },
  setting: {
    // targetMarginDefault = 0.30, NO el default hardcodeado (0.15/DEFAULT_TARGET_MARGIN).
    findMany: async () => ([
      { key: 'fixedMonthly', value: '0' },
      { key: 'targetMarginDefault', value: '0.30' },
    ]),
  },
  payable: {
    findMany: async () => [],
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const vehicleService = require('../vehicleService');

test('findById: usa targetMarginDefault del Setting (0.30), no el fallback hardcodeado (0.15)', async () => {
  const vehicle = await vehicleService.findById('veh-1', 'user-1');

  // realCostWithFixed = purchasePrice (20M) + gastos (0) + fijo prorrateado (0, fixedMonthly=0) = 20M
  // Con margen 0.30: targetPrice = 20M * 1.30 = 26M, targetProfit = 20M * 0.30 = 6M
  // Si el 4to argumento se hubiera perdido (fallback 0.15): targetPrice sería 23M — el test fallaría.
  assert.equal(vehicle.metrics.effectiveMargin, 0.30);
  assert.equal(vehicle.metrics.isCustomMargin, false);
  assert.equal(vehicle.metrics.targetPrice, 26_000_000);
  assert.equal(vehicle.metrics.targetProfit, 6_000_000);
});
