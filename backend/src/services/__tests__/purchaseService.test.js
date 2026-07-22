const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPurchasePayments } = require('../purchaseService');

// Stub de tx: balance alto, captura writes. account.findFirst devuelve la cuenta SOCIO (o null).
const mkTx = (socioAccount = { id: 'accSocio', type: 'SOCIO' }) => {
  const created = { transactions: [], payablePayments: [], payableUpdate: null };
  return {
    _created: created,
    account: {
      findUnique: async ({ where }) => ({ id: where.id, name: 'Caja', isActive: true }),
      findFirst: async () => socioAccount,
    },
    transaction: {
      findMany: async () => [],           // balance base 0…
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async ({ data }) => { const t = { id: `tx${created.transactions.length + 1}`, ...data }; created.transactions.push(t); return t; },
    },
    payablePayment: { create: async ({ data }) => { created.payablePayments.push(data); return data; } },
    payable: { update: async ({ data }) => { created.payableUpdate = data; return data; } },
  };
};

test('aporte socio: UN egreso desde la cuenta SOCIO (no INCOME+EXPENSE) + tu parte → PAID', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000,
    partnerContribution: 8_000_000, socioThirdPartyId: 'socio1',
    payments: [{ accountId: 'accB', amount: 12_000_000 }],
  });
  const socioTx = tx._created.transactions.filter(t => t.accountId === 'accSocio');
  assert.equal(socioTx.length, 1);            // solo UN egreso, no INCOME+EXPENSE
  assert.equal(socioTx[0].type, 'EXPENSE');
  assert.equal(socioTx[0].amount, 8_000_000);
  assert.equal(tx._created.transactions.filter(t => t.type === 'INCOME').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('socio 100%: UN egreso 20M desde la cuenta SOCIO → PAID', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 20_000_000, socioThirdPartyId: 'socio1',
    payments: [],
  });
  assert.equal(tx._created.transactions.filter(t => t.accountId === 'accSocio' && t.type === 'EXPENSE')[0].amount, 20_000_000);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('socio sin cuenta SOCIO activa → 400', async () => {
  const tx = mkTx(null); // findFirst devuelve null
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
      thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 8_000_000, socioThirdPartyId: 'socio1',
      payments: [{ accountId: 'accB', amount: 12_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});

test('sin socio: comportamiento actual (solo tus pagos, sin cuenta SOCIO)', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'X', partnerId: null }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 0, socioThirdPartyId: null,
    payments: [{ accountId: 'accB', amount: 20_000_000 }],
  });
  assert.equal(tx._created.transactions.filter(t => t.accountId === 'accSocio').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('sobre-pago (aporte + pagos > precio) → 400', async () => {
  const tx = mkTx();
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle: { id: 'v1', plate: 'ABC123', partnerId: 'socio-ext' }, userId: 'u1', date: null, thirdPartyId: 'p',
      totalDue: 20_000_000, partnerContribution: 15_000_000, socioThirdPartyId: 's',
      payments: [{ accountId: 'accB', amount: 10_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});
