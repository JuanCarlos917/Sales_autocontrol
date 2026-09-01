'use strict';
// getPipelineTarget — agregado de la meta del pipeline sobre el inventario activo.
// Se reemplaza `../config/database` en el require cache por un prisma falso.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let vehiclesFixture = [];
let lastFindManyArgs = null;

const fakePrisma = {
  setting: {
    findUnique: async ({ where }) => (
      where.key === 'targetMarginDefault' ? { value: '0.15' } : { value: '0' }
    ),
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

test('getPipelineTarget: suma solo stages activos y calcula la brecha', async () => {
  vehiclesFixture = [
    { stage: 'PUBLICADO', purchasePrice: 30_000_000, listedPrice: 35_000_000, expenses: [] }, // target 34.5M, MEETS
    { stage: 'DISPONIBLE', purchasePrice: 20_000_000, listedPrice: 21_000_000, expenses: [] }, // target 23M, PROFIT
  ];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(lastFindManyArgs.where.userId, 'user1');
  assert.deepEqual(lastFindManyArgs.where.stage, {
    in: ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'],
  });
  assert.equal(r.vehicleCount, 2);
  assert.equal(r.sumTargetPrice, 57_500_000); // 34.5M + 23M
  assert.equal(r.sumListed, 56_000_000); // 35M + 21M
  assert.equal(r.pipelineGap, -1_500_000); // 56M − 57.5M
  assert.equal(r.statusCounts.MEETS, 1);
  assert.equal(r.statusCounts.PROFIT, 1);
});

test('getPipelineTarget: inventario vacío → ceros sin crash', async () => {
  vehiclesFixture = [];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(r.vehicleCount, 0);
  assert.equal(r.sumTargetPrice, 0);
  assert.equal(r.pipelineGap, 0);
});
