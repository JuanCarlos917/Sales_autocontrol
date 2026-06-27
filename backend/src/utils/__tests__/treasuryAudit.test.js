// Unit tests del helper writeTreasuryAudit / snapshotEntity.
// Runner: node:test (Node 18+).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeTreasuryAudit, snapshotEntity, VALID_ENTITIES, VALID_ACTIONS } =
  require('../treasuryAudit');

// Mock mínimo de PrismaClient (sólo lo que el helper toca).
const makeMockPrisma = () => {
  const calls = [];
  return {
    calls,
    treasuryAuditLog: {
      create: async ({ data }) => {
        calls.push(data);
        return { id: 'audit-mock-id', ...data };
      },
    },
  };
};

test('writeTreasuryAudit: entityType inválido lanza error sin tocar Prisma', async () => {
  const mock = makeMockPrisma();
  await assert.rejects(
    () => writeTreasuryAudit(mock, {
      entityType: 'BOGUS',
      entityId: 'tx-1',
      userId: 'u-1',
      action: 'DELETE',
    }),
    /entityType inválido/,
  );
  assert.equal(mock.calls.length, 0);
});

test('writeTreasuryAudit: action inválida lanza error sin tocar Prisma', async () => {
  const mock = makeMockPrisma();
  await assert.rejects(
    () => writeTreasuryAudit(mock, {
      entityType: 'TRANSACTION',
      entityId: 'tx-1',
      userId: 'u-1',
      action: 'WHATEVER',
    }),
    /action inválida/,
  );
  assert.equal(mock.calls.length, 0);
});

test('writeTreasuryAudit: entityId vacío lanza error', async () => {
  const mock = makeMockPrisma();
  await assert.rejects(
    () => writeTreasuryAudit(mock, {
      entityType: 'TRANSACTION',
      entityId: '',
      userId: 'u-1',
      action: 'DELETE',
    }),
    /entityId requerido/,
  );
});

test('writeTreasuryAudit: payload mínimo válido se persiste tal cual', async () => {
  const mock = makeMockPrisma();
  await writeTreasuryAudit(mock, {
    entityType: 'TRANSFER',
    entityId: 'tr-9',
    userId: 'u-2',
    action: 'DELETE',
    before: { amount: '500' },
    reason: 'transferencia duplicada por reintento',
  });
  assert.equal(mock.calls.length, 1);
  const data = mock.calls[0];
  assert.equal(data.entityType, 'TRANSFER');
  assert.equal(data.action, 'DELETE');
  assert.equal(data.reason, 'transferencia duplicada por reintento');
  assert.deepEqual(data.before, { amount: '500' });
  // No incluir after si no se pasa
  assert.ok(!('after' in data));
});

test('snapshotEntity: serializa Dates a ISO y omite undefined', () => {
  const date = new Date('2026-06-08T10:00:00.000Z');
  const snap = snapshotEntity(
    { id: 'a', name: 'Caja', createdAt: date, missingField: undefined, extra: 'x' },
    ['id', 'name', 'createdAt', 'missingField'],
  );
  assert.equal(snap.id, 'a');
  assert.equal(snap.name, 'Caja');
  assert.equal(snap.createdAt, '2026-06-08T10:00:00.000Z');
  assert.ok(!('missingField' in snap));
  assert.ok(!('extra' in snap));
});

test('VALID_ENTITIES / VALID_ACTIONS coinciden con el contrato del audit', () => {
  assert.deepEqual(
    VALID_ENTITIES.slice().sort(),
    ['ACCOUNT', 'CASH_COUNT', 'DEBT', 'DEBT_PAYMENT', 'LOAN', 'LOAN_PAYMENT', 'PAYABLE', 'PAYABLE_PAYMENT', 'TRANSACTION', 'TRANSFER'],
  );
  assert.deepEqual(
    VALID_ACTIONS.slice().sort(),
    ['CANCEL', 'CREATE', 'DELETE', 'PAYMENT', 'REVERSE', 'UPDATE'],
  );
});
