// Unit tests del guard de borrado de terceros de sistema.
// Runner: node:test (Node 18+), sin DB — el guard corre antes de tocar Prisma.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../thirdPartyService');
const { AppError } = require('../../middleware/errorHandler');

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
