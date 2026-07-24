'use strict';
// Tests — loader de cadena de cruces con prisma inyectable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadChainMembers } = require('../dealChain');

// Nodos "de DB": A (raíz, con socio) → B (cruce de A) → C (cruce de B).
const DB = {
  'veh-a': { id: 'veh-a', plate: 'AAA111', stage: 'VENDIDO', salePrice: 50, purchasePrice: 40,
    negotiatedValue: null, fromTradeIn: false, saleDate: new Date('2026-07-01'), sourceVehicleId: null,
    partnerId: 'socio-cap', participation: 0, partnerContribution: 40,
    expenses: [], tradeInsReceived: [{ id: 'veh-b' }] },
  'veh-b': { id: 'veh-b', plate: 'BBB222', stage: 'VENDIDO', salePrice: 25, purchasePrice: null,
    negotiatedValue: 20, fromTradeIn: true, saleDate: new Date('2026-07-10'), sourceVehicleId: 'veh-a',
    partnerId: null, participation: 1, partnerContribution: null,
    expenses: [{ amount: 1, deletedAt: null }], tradeInsReceived: [{ id: 'veh-c' }] },
  'veh-c': { id: 'veh-c', plate: 'CCC333', stage: 'DISPONIBLE', salePrice: null, purchasePrice: null,
    negotiatedValue: 8, fromTradeIn: true, saleDate: null, sourceVehicleId: 'veh-b',
    partnerId: null, participation: 1, partnerContribution: null,
    expenses: [], tradeInsReceived: [] },
};

const fakePrisma = {
  vehicle: {
    findMany: async ({ where }) => {
      const ids = where.id?.in ?? [where.id];
      return ids.map((id) => DB[id]).filter(Boolean);
    },
  },
};

test('loadChainMembers: desde el último eslabón devuelve la cadena completa raíz-primero', async () => {
  const members = await loadChainMembers(fakePrisma, 'veh-c');
  assert.deepEqual(members.map((m) => m.id), ['veh-a', 'veh-b', 'veh-c']);
  // Campos de socio y cruce presentes en los nodos.
  assert.equal(members[0].partnerId, 'socio-cap');
  assert.equal(members[0].partnerContribution, 40);
  assert.equal(members[1].fromTradeIn, true);
  assert.equal(members[1].negotiatedValue, 20);
  assert.deepEqual(members[0].tradeInIds, ['veh-b']);
});

test('loadChainMembers: desde un eslabón intermedio devuelve la misma cadena', async () => {
  const members = await loadChainMembers(fakePrisma, 'veh-b');
  assert.deepEqual(members.map((m) => m.id), ['veh-a', 'veh-b', 'veh-c']);
});

test('loadChainMembers: id inexistente → []', async () => {
  assert.deepEqual(await loadChainMembers(fakePrisma, 'nope'), []);
});

test('loadChainMembers: referencia rota (sourceVehicleId borrado) no revienta', async () => {
  const broken = {
    vehicle: {
      findMany: async ({ where }) => {
        const ids = where.id?.in ?? [where.id];
        // 'veh-x' apunta a un source que ya no existe.
        const rows = { 'veh-x': { id: 'veh-x', plate: 'XXX000', stage: 'VENDIDO', salePrice: 10,
          purchasePrice: 5, negotiatedValue: null, fromTradeIn: true, saleDate: null,
          sourceVehicleId: 'gone', partnerId: null, participation: 1, partnerContribution: null,
          expenses: [], tradeInsReceived: [] } };
        return ids.map((id) => rows[id]).filter(Boolean);
      },
    },
  };
  const members = await loadChainMembers(broken, 'veh-x');
  assert.deepEqual(members.map((m) => m.id), ['veh-x']);
});
