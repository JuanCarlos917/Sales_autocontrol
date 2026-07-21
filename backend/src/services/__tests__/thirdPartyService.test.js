// Unit tests del guard de borrado de terceros de sistema.
// Runner: node:test (Node 18+), sin DB — el guard corre antes de tocar Prisma.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../thirdPartyService');
const { AppError } = require('../../middleware/errorHandler');
const { ensureSocioAccount } = require('../thirdPartyService');

const { assertThirdPartyDeletable } = service;

test('guard: rechaza borrar el tercero de sistema owner-self (400)', () => {
  assert.throws(
    () => assertThirdPartyDeletable('owner-self'),
    (e) => e instanceof AppError && e.statusCode === 400 && /sistema/i.test(e.message),
  );
});

test('guard: un tercero normal sí se puede borrar (no lanza)', () => {
  assert.doesNotThrow(() => assertThirdPartyDeletable('cmpanytpid123'));
});

const mkPrisma = (existing = null) => {
  const created = [];
  return {
    _created: created,
    account: {
      findFirst: async () => existing,
      create: async ({ data }) => { const a = { id: 'acc1', ...data }; created.push(a); return a; },
    },
  };
};

test('ensureSocioAccount: tercero PARTNER sin cuenta → crea cuenta SOCIO', async () => {
  const p = mkPrisma(null);
  const out = await ensureSocioAccount(p, { id: 'tp1', name: 'Mamá', type: 'PARTNER' });
  assert.equal(out.type, 'SOCIO');
  assert.equal(out.thirdPartyId, 'tp1');
  assert.equal(out.name, 'Cuenta Socio — Mamá');
  assert.equal(p._created.length, 1);
});

test('ensureSocioAccount: tercero PARTNER con cuenta existente → no duplica', async () => {
  const p = mkPrisma({ id: 'accX', type: 'SOCIO', thirdPartyId: 'tp1' });
  const out = await ensureSocioAccount(p, { id: 'tp1', name: 'Mamá', type: 'PARTNER' });
  assert.equal(out.id, 'accX');
  assert.equal(p._created.length, 0);
});

test('ensureSocioAccount: tercero no-PARTNER → no crea (null)', async () => {
  const p = mkPrisma(null);
  const out = await ensureSocioAccount(p, { id: 'tp2', name: 'Cliente', type: 'CLIENT' });
  assert.equal(out, null);
  assert.equal(p._created.length, 0);
});
