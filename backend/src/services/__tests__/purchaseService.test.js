const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPurchasePayments } = require('../purchaseService');

// Stub mínimo de tx: balance alto, captura writes.
const mkTx = () => {
  const created = { transactions: [], payablePayments: [], payableUpdate: null };
  return {
    _created: created,
    account: { findUnique: async ({ where }) => ({ id: where.id, name: 'Caja', isActive: true }) },
    transaction: {
      findMany: async () => [],           // balance base 0…
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async ({ data }) => { const t = { id: `tx${created.transactions.length + 1}`, ...data }; created.transactions.push(t); return t; },
    },
    payablePayment: { create: async ({ data }) => { created.payablePayments.push(data); return data; } },
    payable: { update: async ({ data }) => { created.payableUpdate = data; return data; } },
  };
};

const vehicle = { id: 'v1', plate: 'ABC123', partnerId: 'socio-ext' };

test('aporte socio externo: par INCOME+EXPENSE + pago propio → CxP PAID contra precio total', async () => {
  const tx = mkTx();
  const payable = { id: 'cxp1' };
  const out = await applyPurchasePayments(tx, {
    payable, vehicle, userId: 'u1', date: null,
    thirdPartyId: 'prov1',            // proveedor
    totalDue: 20_000_000,
    partnerContribution: 8_000_000, partnerAccountId: 'accA', socioThirdPartyId: 'socio-ext',
    payments: [{ accountId: 'accB', amount: 12_000_000, method: 'CASH' }],
  });
  // 3 transacciones: INCOME aporte, EXPENSE aporte, EXPENSE tu parte
  const cats = tx._created.transactions.map(t => `${t.type}:${t.category}`);
  assert.deepEqual(cats.sort(), ['EXPENSE:VEHICLE_PURCHASE', 'EXPENSE:VEHICLE_PURCHASE', 'INCOME:CAPITAL_CONTRIBUTION'].sort());
  // aporte INCOME a accA por 8M, con thirdParty socio
  const income = tx._created.transactions.find(t => t.type === 'INCOME');
  assert.equal(income.accountId, 'accA'); assert.equal(income.amount, 8_000_000); assert.equal(income.thirdPartyId, 'socio-ext');
  // PayablePayments suman 20M
  assert.equal(tx._created.payablePayments.reduce((s, p) => s + p.amount, 0), 20_000_000);
  assert.equal(tx._created.payableUpdate.paidAmount, 20_000_000);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
  assert.equal(out.totalPaid, 20_000_000);
});

test('socio 100%: sin pago propio, solo el par del socio → PAID', async () => {
  const tx = mkTx();
  const out = await applyPurchasePayments(tx, {
    payable: { id: 'cxp2' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'prov1',
    totalDue: 20_000_000,
    partnerContribution: 20_000_000, partnerAccountId: 'accA', socioThirdPartyId: 'socio-inv',
    payments: [],
  });
  assert.equal(tx._created.payableUpdate.status, 'PAID');
  assert.equal(out.totalPaid, 20_000_000);
});

test('sin socio: comportamiento actual (solo pagos propios, status contra totalDue)', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'cxp3' }, vehicle: { id: 'v', plate: 'X', partnerId: null }, userId: 'u1', date: null,
    thirdPartyId: 'prov1', totalDue: 20_000_000,
    partnerContribution: 0, partnerAccountId: null, socioThirdPartyId: null,
    payments: [{ accountId: 'accB', amount: 20_000_000 }],
  });
  assert.equal(tx._created.transactions.filter(t => t.type === 'INCOME').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('sobre-pago (aporte + pagos > precio) → 400', async () => {
  const tx = mkTx();
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'p',
      totalDue: 20_000_000, partnerContribution: 15_000_000, partnerAccountId: 'accA', socioThirdPartyId: 's',
      payments: [{ accountId: 'accB', amount: 10_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});

test('aporte > 0 sin partnerAccountId → 400', async () => {
  const tx = mkTx();
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'p',
      totalDue: 20_000_000, partnerContribution: 8_000_000, partnerAccountId: null, socioThirdPartyId: 's',
      payments: [{ accountId: 'accB', amount: 12_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});
