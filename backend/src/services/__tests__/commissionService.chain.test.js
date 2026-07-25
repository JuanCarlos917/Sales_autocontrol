'use strict';
// Tests — helpers de cadena para el cierre del negocio con cruce.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findDistributedVehicleIds, resolveChainSocio, DISTRIBUTION_PAYABLE_TYPES,
} = require('../commissionService');

const CFG = { investorTeam: [{ thirdPartyId: 'socio-cap', sharePct: 100 }] };

function mkTx({ payableRows = [], thirdParties = ['socio-cap', 'owner-self', 'ext-socio'] } = {}) {
  const has = new Set(thirdParties);
  return {
    payable: { findMany: async () => payableRows },
    thirdParty: {
      findMany: async ({ where }) => where.id.in.filter((id) => has.has(id)).map((id) => ({ id })),
      findUnique: async ({ where }) => (has.has(where.id) ? { id: where.id } : null),
    },
  };
}

test('DISTRIBUTION_PAYABLE_TYPES: los 4 tipos, sin CAPITAL_RETURN', () => {
  assert.deepEqual(
    [...DISTRIBUTION_PAYABLE_TYPES].sort(),
    ['COMMISSION', 'COMMISSION_RETURN', 'PARTNER_SHARE', 'PROFIT_SHARE'],
  );
});

test('findDistributedVehicleIds: agrupa vehicleIds con payables de distribución', async () => {
  const tx = mkTx({ payableRows: [{ vehicleId: 'veh-a' }, { vehicleId: 'veh-a' }] });
  const set = await findDistributedVehicleIds(tx, ['veh-a', 'veh-b']);
  assert.equal(set.has('veh-a'), true);
  assert.equal(set.has('veh-b'), false);
});

test('findDistributedVehicleIds: lista vacía → Set vacío sin query', async () => {
  const tx = { payable: { findMany: async () => { throw new Error('no debe consultar'); } } };
  const set = await findDistributedVehicleIds(tx, []);
  assert.equal(set.size, 0);
});

test('resolveChainSocio: toma el primer eslabón con partnerId (socio inversionista 100%)', async () => {
  const members = [
    { id: 'veh-a', partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000 },
    { id: 'veh-b', partnerId: null, participation: 1 },
  ];
  const socio = await resolveChainSocio(mkTx(), members, CFG);
  assert.equal(socio.thirdPartyId, 'socio-cap');
  assert.equal(socio.isInvestor, true);
  assert.equal(socio.share, 1);
  assert.equal(socio.vehicle.id, 'veh-a');
});

test('resolveChainSocio: sin partnerId en la cadena → null', async () => {
  const members = [{ id: 'veh-b', partnerId: null, participation: 1 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});

test('resolveChainSocio: socio externo parcial NO lidera cadena → null', async () => {
  const members = [{ id: 'veh-a', partnerId: 'ext-socio', participation: 0.6 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});

test('resolveChainSocio: invariante rota post-venta (AppError de resolveSocio) → null, no revienta', async () => {
  // 'ext-socio' con participation 0 → share 1 pero NO es inversionista → resolveSocio lanza AppError.
  const members = [{ id: 'veh-a', partnerId: 'ext-socio', participation: 0 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});
