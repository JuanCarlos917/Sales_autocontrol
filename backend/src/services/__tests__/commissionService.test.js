// Unit tests del armado puro de items de comisión por vehículo.
// Runner: node:test (Node 18+), sin DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCommissionVehicleItem } = require('../commissionService');

const vehicle = {
  id: 'v1', plate: 'FJT326', brand: 'Suzuki', model: 'Vitara',
  saleDate: '2026-06-01T00:00:00Z', salePrice: 57_500_000,
  purchasePrice: 50_000_000, negotiatedValue: null, fromTradeIn: false,
  participation: 1,
  expenses: [{ amount: 2_454_000, category: 'MECANICA', deletedAt: null }],
};

const mkPayable = (over = {}) => ({
  id: 'pay-1', status: 'PENDING', totalAmount: 908_280, paidAmount: 0,
  thirdParty: { id: 'owner-self', name: 'Juan' },
  saleParticipant: { role: 'CAPTADOR', sharePct: 30 },
  payments: [],
  ...over,
});

test('item: cascada desde calculateCommissionBase + pool desde payables', () => {
  const payables = [
    mkPayable(),
    mkPayable({ id: 'pay-2', totalAmount: 2_119_320, saleParticipant: { role: 'CERRADOR', sharePct: 70 } }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  assert.equal(item.vehicle.plate, 'FJT326');
  assert.equal(item.cascade.grossProfit, 5_046_000);
  assert.equal(item.cascade.commissionBase, 5_046_000);
  assert.equal(item.cascade.commissionPool, 3_027_600); // suma de payables (persistido)
  assert.equal(item.cascade.purchaseCost, 50_000_000);
  assert.equal(item.cascade.directExpenses, 2_454_000);
  assert.equal(item.roles.length, 2);
  assert.equal(item.hasPending, true);
});

test('item: rol con pagos — paid/pending/status y payments aplanados', () => {
  const payables = [mkPayable({
    status: 'PARTIAL', paidAmount: 400_000,
    payments: [{ amount: 400_000, transaction: { date: '2026-06-05T00:00:00Z', account: { name: 'Efectivo' } } }],
  })];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  const rol = item.roles[0];
  assert.equal(rol.paid, 400_000);
  assert.equal(rol.pending, 508_280);
  assert.equal(rol.status, 'PARTIAL');
  assert.deepEqual(rol.payments, [{ date: '2026-06-05T00:00:00Z', amount: 400_000, accountName: 'Efectivo' }]);
});

test('item: todos pagados — hasPending false; cancelada no cuenta como pendiente', () => {
  const payables = [
    mkPayable({ status: 'PAID', paidAmount: 908_280 }),
    mkPayable({ id: 'pay-2', status: 'CANCELLED' }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  assert.equal(item.hasPending, false);
});

test('item: buckets desde transfers; null si no hay', () => {
  const withB = buildCommissionVehicleItem({
    vehicle, payables: [mkPayable()],
    bucketTransfers: [
      { bucket: 'reinvest', amount: 1_513_800 },
      { bucket: 'tax', amount: 504_600 },
    ],
  });
  assert.deepEqual(withB.buckets, { reinvest: 1_513_800, tax: 504_600 });
  const noB = buildCommissionVehicleItem({ vehicle, payables: [mkPayable()], bucketTransfers: [] });
  assert.equal(noB.buckets, null);
});

test('item: sharePct derivable aunque falte saleParticipant (dato legacy)', () => {
  const payables = [
    mkPayable({ saleParticipant: null }),
    mkPayable({ id: 'pay-2', totalAmount: 2_119_320, saleParticipant: null }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  // 908280 / 3027600 = 30% (derivado de montos reales)
  assert.equal(item.roles[0].sharePct, 30);
  assert.equal(item.roles[0].role, 'OTHER');
});

test('item: gasto legacy COMISION no rompe la identidad de la cascada', () => {
  const v = { ...vehicle, expenses: [...vehicle.expenses, { amount: 999_999, category: 'COMISION', deletedAt: null }] };
  const item = buildCommissionVehicleItem({ vehicle: v, payables: [mkPayable()], bucketTransfers: [] });
  assert.equal(item.cascade.directExpenses, 2_454_000);
  assert.equal(
    item.cascade.salePrice - item.cascade.purchaseCost - item.cascade.directExpenses,
    item.cascade.grossProfit,
  );
});
