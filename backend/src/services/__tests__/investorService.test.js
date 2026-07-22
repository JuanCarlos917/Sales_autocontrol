// Unit tests de investorService — reporte por persona de ganancia
// (Payable PROFIT_SHARE), espejo de los tests de agregación de comisiones.
// Runner: node:test (Node 18+), sin DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const investorService = require('../investorService');
const commissionService = require('../commissionService');
const payableService = require('../payableService');

// ── Stub de prisma: filtra payables por type (como haría el where real) ──
const PAYABLES = [
  // COMMISSION — debe quedar afuera del reporte de inversionistas.
  {
    type: 'COMMISSION', vehicleId: 'v1', thirdPartyId: 'tp-vendedor', status: 'PENDING',
    totalAmount: 1_000_000, paidAmount: 0, thirdParty: { name: 'Vendedor' },
  },
  // PROFIT_SHARE — inv1 en v1 (pendiente) y v2 (pagado); inv2 en v2 (parcial).
  {
    type: 'PROFIT_SHARE', vehicleId: 'v1', thirdPartyId: 'inv1', status: 'PENDING',
    totalAmount: 2_000_000, paidAmount: 500_000, thirdParty: { name: 'Mamá' },
  },
  {
    type: 'PROFIT_SHARE', vehicleId: 'v2', thirdPartyId: 'inv2', status: 'PARTIAL',
    totalAmount: 1_000_000, paidAmount: 200_000, thirdParty: { name: 'Papá' },
  },
  {
    type: 'PROFIT_SHARE', vehicleId: 'v2', thirdPartyId: 'inv1', status: 'PAID',
    totalAmount: 500_000, paidAmount: 500_000, thirdParty: { name: 'Mamá' },
  },
];

function mkTx(payables = PAYABLES, paymentRows = []) {
  return {
    payable: {
      findMany: async ({ where }) =>
        payables.filter((p) => p.type === where.type && p.vehicleId !== null),
    },
    payablePayment: {
      aggregate: async ({ where }) => {
        const sum = paymentRows
          .filter((p) => p.payableType === where.payable.type && new Date(p.createdAt) >= where.createdAt.gte)
          .reduce((s, p) => s + p.amount, 0);
        return { _sum: { amount: sum } };
      },
    },
  };
}

// ── getSummary: solo PROFIT_SHARE, byPerson ordenado por pendiente ──────

test('investorService.getSummary: agrega solo PROFIT_SHARE, ignora COMMISSION', async () => {
  const tx = mkTx();
  const summary = await investorService.getSummary(tx);

  assert.equal(summary.byPerson.length, 2); // inv1, inv2 — NO tp-vendedor
  assert.ok(!summary.byPerson.some((p) => p.thirdParty.id === 'tp-vendedor'));

  const inv1 = summary.byPerson.find((p) => p.thirdParty.id === 'inv1');
  assert.equal(inv1.thirdParty.name, 'Mamá');
  assert.equal(inv1.totalPending, 1_500_000); // pendiente de v1 (2M - 500k)
  assert.equal(inv1.totalPaid, 1_000_000);    // 500k (v1) + 500k (v2, PAID)
  assert.equal(inv1.salesCount, 2);           // v1 + v2

  const inv2 = summary.byPerson.find((p) => p.thirdParty.id === 'inv2');
  assert.equal(inv2.totalPending, 800_000);   // 1M - 200k
  assert.equal(inv2.salesCount, 1);

  assert.equal(summary.pendingTotal, 1_500_000 + 800_000);
  // Orden: mayor pendiente primero.
  assert.equal(summary.byPerson[0].thirdParty.id, 'inv1');
});

test('retro-compat: commissionService.getSummary (default param) sigue viendo solo COMMISSION', async () => {
  const tx = mkTx();
  const summary = await commissionService.getSummary(tx);
  assert.equal(summary.byPerson.length, 1);
  assert.equal(summary.byPerson[0].thirdParty.id, 'tp-vendedor');
  assert.equal(summary.byPerson[0].totalPending, 1_000_000);
});

test('investorService.getSummary: sin filas PROFIT_SHARE → byPerson vacío', async () => {
  const tx = mkTx(PAYABLES.filter((p) => p.type === 'COMMISSION'));
  const summary = await investorService.getSummary(tx);
  assert.deepEqual(summary.byPerson, []);
  assert.equal(summary.pendingTotal, 0);
});

// ── getSummary: paidThisMonth solo suma pagos PROFIT_SHARE del mes ──────
// (gap detectado en revisión de Task 6: el aggregate real filtra por
// payable.type + createdAt >= monthStart; ningún test lo ejercía con
// filas de pago no vacías).

test('investorService.getSummary: paidThisMonth solo suma pagos PROFIT_SHARE dentro del mes actual', async () => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 20, 12, 0, 0);

  const paymentRows = [
    // COMMISSION este mes — no debe contar en el reporte de inversionistas.
    { payableType: 'COMMISSION', amount: 900_000, createdAt: thisMonth },
    // PROFIT_SHARE este mes — sí cuentan.
    { payableType: 'PROFIT_SHARE', amount: 300_000, createdAt: thisMonth },
    { payableType: 'PROFIT_SHARE', amount: 400_000, createdAt: thisMonth },
    // PROFIT_SHARE del mes anterior — excluido por createdAt < monthStart.
    { payableType: 'PROFIT_SHARE', amount: 999_999, createdAt: lastMonth },
  ];

  const tx = mkTx(PAYABLES, paymentRows);
  const summary = await investorService.getSummary(tx);

  // Solo 300k + 400k (PROFIT_SHARE, este mes); excluye la COMMISSION del
  // mes actual y la PROFIT_SHARE del mes anterior.
  assert.equal(summary.paidThisMonth, 700_000);
});

// ── addPayment: reutiliza el flujo genérico de payableService.addPayment ──
// (mismo PayablePayment/Transaction/treasuryAudit que usan las comisiones).
// payableService.addPayment abre una $transaction real con locks + balance;
// eso requiere DB, así que aquí verificamos DELEGACIÓN: mismos argumentos,
// mismo resultado pasado tal cual (no se reimplementa el flujo de pago).

test('investorService.addPayment: delega en payableService.addPayment sin reimplementar el flujo', async (t) => {
  const calls = [];
  t.mock.method(payableService, 'addPayment', async (payableId, paymentData, userId) => {
    calls.push({ payableId, paymentData, userId });
    return {
      payable: { id: payableId, status: 'PARTIAL', paidAmount: 700_000, totalAmount: 2_000_000 },
      transaction: { id: 'txn-1' },
      payment: { id: 'pp-1', amount: paymentData.amount },
    };
  });

  const result = await investorService.addPayment(
    'pay-inv1',
    { accountId: 'acc-1', amount: 200_000, date: '2026-07-16' },
    'user-1',
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    payableId: 'pay-inv1',
    paymentData: { accountId: 'acc-1', amount: 200_000, date: '2026-07-16' },
    userId: 'user-1',
  });
  // El pendiente baja: totalAmount 2M, paidAmount ahora 700k → pending 1.3M.
  assert.equal(result.payable.totalAmount - result.payable.paidAmount, 1_300_000);
  assert.equal(result.payment.amount, 200_000);
});
