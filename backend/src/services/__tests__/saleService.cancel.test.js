'use strict';
// ═══════════════════════════════════════════════════════════════
// cancelSale — guard de CxP devengadas.
//
// Bug: tras Task 4, toda venta sin skip crea CxP PROFIT_SHARE además
// de (opcionalmente) COMMISSION. El guard de cancelSale solo revisaba
// COMMISSION, así que una venta sin vendedores (0 COMMISSION, N
// PROFIT_SHARE) pasaba el guard y dejaba CxP PROFIT_SHARE huérfanas
// apuntando a un vehículo que vuelve a DISPONIBLE.
//
// Mismo patrón que saleService.dist.test.js: se reemplaza el módulo
// `../config/database` en el require cache por un prisma falso.
// ═══════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { vehicle, transactions, settings } — se fija por test

const matchesType = (type, filter) => {
  if (typeof filter === 'string') return type === filter;
  if (filter && Array.isArray(filter.in)) return filter.in.includes(type);
  return false;
};

const fakePrisma = {
  vehicle: {
    findUnique: async () => ctx.vehicle,
    update: async ({ data }) => ({ ...ctx.vehicle, ...data }),
  },
  transaction: {
    findMany: async () => ctx.transactions || [],
  },
  payable: {
    findMany: async ({ where }) =>
      (ctx.vehicle.payables || []).filter(
        (p) => p.vehicleId === where.vehicleId && matchesType(p.type, where.type)
      ),
    delete: async () => ({}),
  },
  setting: {
    findMany: async () => ctx.settings || [],
  },
  transfer: {
    findMany: async () => [],
  },
  $transaction: async (fn) =>
    fn({
      payable: { delete: async () => ({}) },
      vehicle: { update: async ({ data }) => ({ ...ctx.vehicle, ...data }) },
    }),
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const saleService = require('../saleService');

const baseVehicle = (payables = []) => ({
  id: 'veh-1',
  plate: 'ABC123',
  stage: 'VENDIDO',
  payables,
});

test('cancelSale: bloquea cuando hay CxP PROFIT_SHARE devengadas (sin COMMISSION)', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'pay-1', vehicleId: 'veh-1', type: 'PROFIT_SHARE', paidAmount: 0, totalAmount: 3_000_000 },
    ]),
    transactions: [],
    settings: [],
  };

  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /comisiones o ganancias devengadas/);
      return true;
    }
  );
});

test('cancelSale: sigue bloqueado cuando hay CxP COMMISSION devengadas (comportamiento previo)', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'pay-1', vehicleId: 'veh-1', type: 'COMMISSION', paidAmount: 0, totalAmount: 500_000 },
    ]),
    transactions: [],
    settings: [],
  };

  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('cancelSale: bloquea cuando hay CxP PARTNER_SHARE devengadas (ganancia de socio, sin COMMISSION ni PROFIT_SHARE)', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'pay-1', vehicleId: 'veh-1', type: 'PARTNER_SHARE', paidAmount: 0, totalAmount: 1_000_000 },
    ]),
    transactions: [],
    settings: [],
  };

  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /comisiones o ganancias devengadas/);
      assert.match(err.message, /ganancia de socio/);
      return true;
    }
  );
});

test('cancelSale: bloquea cuando hay CxP CAPITAL_RETURN devengada', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'cap-1', vehicleId: 'veh-1', type: 'CAPITAL_RETURN', paidAmount: 0, totalAmount: 8_000_000 },
    ]),
    transactions: [],
    settings: [],
  };

  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /comisiones o ganancias devengadas/);
      return true;
    }
  );
});

test('cancelSale: bloquea cuando hay CxP COMMISSION_RETURN devengada', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'cr-1', vehicleId: 'veh-1', type: 'COMMISSION_RETURN', paidAmount: 0, totalAmount: 1_000_000 },
    ]),
    transactions: [],
    settings: [],
  };
  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (e) => e.statusCode === 400 && /cancelar la venta/i.test(e.message),
  );
});

test('cancelSale: procede cuando no hay CxP COMMISSION, PROFIT_SHARE ni PARTNER_SHARE', async () => {
  ctx = {
    vehicle: baseVehicle([]),
    transactions: [],
    settings: [],
  };

  const result = await saleService.cancelSale('veh-1', 'u-1');
  assert.equal(result.stage, 'DISPONIBLE');
});
