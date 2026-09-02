'use strict';
// getPipelineTarget — agregado de la meta del pipeline sobre el inventario activo.
// Se reemplaza `../config/database` en el require cache por un prisma falso.
//
// Nota: dashboardService delega la lectura de fixedMonthly/targetMarginDefault en
// utils/settingsHelper.getMetricsSettings(), que hace un solo `setting.findMany`
// (en vez de dos `findUnique`) — el fake de abajo debe exponer ese mismo método.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let vehiclesFixture = [];
let lastFindManyArgs = null;

const fakePrisma = {
  setting: {
    findMany: async ({ where }) => {
      const keys = where.key.in;
      const rows = [];
      if (keys.includes('targetMarginDefault')) rows.push({ key: 'targetMarginDefault', value: '0.15' });
      if (keys.includes('fixedMonthly')) rows.push({ key: 'fixedMonthly', value: '0' });
      return rows;
    },
  },
  vehicle: {
    findMany: async (args) => {
      lastFindManyArgs = args;
      return vehiclesFixture;
    },
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const dashboardService = require('../dashboardService');

test('getPipelineTarget: suma solo stages activos y calcula la brecha (incl. sumTargetProfit/sumRealCost)', async () => {
  vehiclesFixture = [
    { stage: 'PUBLICADO', purchasePrice: 30_000_000, listedPrice: 35_000_000, expenses: [] }, // target 34.5M, profit 4.5M, MEETS
    { stage: 'DISPONIBLE', purchasePrice: 20_000_000, listedPrice: 21_000_000, expenses: [] }, // target 23M, profit 3M, PROFIT
  ];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(lastFindManyArgs.where.userId, 'user1');
  assert.deepEqual(lastFindManyArgs.where.stage, {
    in: ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'],
  });
  assert.equal(r.vehicleCount, 2);
  assert.equal(r.sumTargetPrice, 57_500_000); // 34.5M + 23M
  assert.equal(r.sumTargetProfit, 7_500_000); // 4.5M + 3M
  assert.equal(r.sumRealCost, 50_000_000); // 30M + 20M
  assert.equal(r.sumListed, 56_000_000); // 35M + 21M
  assert.equal(r.pipelineGap, -1_500_000); // 56M − 57.5M
  assert.equal(r.statusCounts.MEETS, 1);
  assert.equal(r.statusCounts.PROFIT, 1);
  assert.equal(r.statusCounts.BELOW, 0);
  assert.equal(r.statusCounts.unknown, 0);
});

test('getPipelineTarget: inventario vacío → ceros sin crash', async () => {
  vehiclesFixture = [];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(r.vehicleCount, 0);
  assert.equal(r.sumTargetPrice, 0);
  assert.equal(r.sumTargetProfit, 0);
  assert.equal(r.sumRealCost, 0);
  assert.equal(r.pipelineGap, 0);
});

test('getPipelineTarget: ejercita los contadores BELOW y unknown', async () => {
  vehiclesFixture = [
    { stage: 'PUBLICADO', purchasePrice: 30_000_000, listedPrice: 35_000_000, expenses: [] }, // MEETS
    { stage: 'DISPONIBLE', purchasePrice: 20_000_000, listedPrice: 21_000_000, expenses: [] }, // PROFIT
    // listedPrice (9M) < realCostWithFixed (10M) → no cubre ni siquiera el costo → BELOW.
    { stage: 'ALISTAMIENTO', purchasePrice: 10_000_000, listedPrice: 9_000_000, expenses: [] },
    // Sin listedPrice (0) y no vendido → referencePrice=0 → targetStatus=null → unknown.
    { stage: 'COMPRADO', purchasePrice: 15_000_000, listedPrice: 0, expenses: [] },
  ];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(r.vehicleCount, 4);
  assert.equal(r.statusCounts.MEETS, 1);
  assert.equal(r.statusCounts.PROFIT, 1);
  assert.equal(r.statusCounts.BELOW, 1);
  assert.equal(r.statusCounts.unknown, 1);
  // sumTargetPrice: 34.5M + 23M + 11.5M + 17.25M
  assert.equal(r.sumTargetPrice, 86_250_000);
  // sumTargetProfit: 4.5M + 3M + 1.5M + 2.25M
  assert.equal(r.sumTargetProfit, 11_250_000);
  // sumRealCost: 30M + 20M + 10M + 15M
  assert.equal(r.sumRealCost, 75_000_000);
  // sumListed: 35M + 21M + 9M + 0
  assert.equal(r.sumListed, 65_000_000);
  // pipelineGap: 65M − 86.25M
  assert.equal(r.pipelineGap, -21_250_000);
});
