// Unit tests del armado puro de items de comisión por vehículo.
// Runner: node:test (Node 18+), sin DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCommissionVehicleItem, buildInvestorVehicleItem, resolveParticipants, MAX_PARTICIPANTS, loadCommissionConfig } = require('../commissionService');
const { resolveSellers, resolveInvestors } = require('../commissionService');
const { AppError } = require('../../middleware/errorHandler');

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

// ── buildInvestorVehicleItem (cascada de GANANCIA, no de comisión) ──
// A diferencia de buildCommissionVehicleItem: NO usa calculateCommissionBase
// (sin `participation`, sin excluir gastos COMISION); grossProfit = salePrice
// − purchaseCost − TODOS los gastos, igual que calculateSaleDistribution.

const mkInvestorPayable = (over = {}) => ({
  id: 'inv-pay-1', status: 'PENDING', totalAmount: 5_400_000, paidAmount: 0,
  thirdParty: { id: 'owner-self', name: 'Juan' },
  saleParticipant: { role: 'INVESTOR', sharePct: 100 },
  payments: [],
  ...over,
});

test('investor item: cascada replica calculateSaleDistribution — grossProfit − commission − reinvest − tax === profitToDistribute', () => {
  // Mismo escenario que investors.spec.ts: venta 30M − costo 20M = gross 10M.
  // commissionPool 1M (10% comisión), reinvest 2.7M, tax 0.9M → profitToDistribute 5.4M.
  const v = {
    id: 'v1', plate: 'INV001', brand: 'Suzuki', model: 'Vitara',
    saleDate: '2026-06-01T00:00:00Z', salePrice: 30_000_000,
    purchasePrice: 20_000_000, negotiatedValue: null, fromTradeIn: false,
    expenses: [],
  };
  const payables = [
    mkInvestorPayable({ id: 'inv-pay-a', totalAmount: 3_240_000, thirdParty: { id: 'invA', name: 'Inversionista A' }, saleParticipant: { role: 'INVESTOR', sharePct: 60 } }),
    mkInvestorPayable({ id: 'inv-pay-b', totalAmount: 2_160_000, thirdParty: { id: 'invB', name: 'Inversionista B' }, saleParticipant: { role: 'INVESTOR', sharePct: 40 } }),
  ];
  const item = buildInvestorVehicleItem({
    vehicle: v,
    payables,
    commissionPayableSum: 1_000_000,
    bucketTransfers: [
      { bucket: 'reinvest', amount: 2_700_000 },
      { bucket: 'tax', amount: 900_000 },
    ],
  });

  assert.equal(item.cascade.salePrice, 30_000_000);
  assert.equal(item.cascade.purchaseCost, 20_000_000);
  assert.equal(item.cascade.directExpenses, 0);
  assert.equal(item.cascade.grossProfit, 10_000_000);
  assert.equal(item.cascade.commissionPool, 1_000_000);
  assert.equal(item.cascade.reinvest, 2_700_000);
  assert.equal(item.cascade.tax, 900_000);
  assert.equal(item.cascade.profitToDistribute, 5_400_000);

  // Invariante de la cascada.
  assert.equal(
    item.cascade.grossProfit - item.cascade.commissionPool - item.cascade.reinvest - item.cascade.tax,
    item.cascade.profitToDistribute,
  );
  // Σ montos de inversionistas === profitToDistribute (persistido).
  const investorsSum = item.roles.reduce((s, r) => s + r.total, 0);
  assert.equal(investorsSum, item.cascade.profitToDistribute);
  assert.equal(item.roles.length, 2);
  assert.deepEqual(item.buckets, { reinvest: 2_700_000, tax: 900_000 });
});

test('investor item: venta sin vendedor (sin comisión) → commissionPool 0, profitToDistribute = ganancia completa', () => {
  const v = {
    id: 'v2', plate: 'INV002', brand: 'Mazda', model: '3',
    saleDate: '2026-06-05T00:00:00Z', salePrice: 25_000_000,
    purchasePrice: 18_000_000, negotiatedValue: null, fromTradeIn: false,
    expenses: [{ amount: 1_000_000, category: 'MECANICA', deletedAt: null }],
  };
  const payables = [mkInvestorPayable({ totalAmount: 6_000_000 })];
  const item = buildInvestorVehicleItem({
    vehicle: v,
    payables,
    commissionPayableSum: 0,
    bucketTransfers: [],
  });

  assert.equal(item.cascade.grossProfit, 6_000_000); // 25M - 18M - 1M
  assert.equal(item.cascade.commissionPool, 0);
  assert.equal(item.cascade.reinvest, 0);
  assert.equal(item.cascade.tax, 0);
  assert.equal(item.cascade.profitToDistribute, 6_000_000);
  assert.equal(item.buckets, null);
  assert.equal(item.cascade.grossProfit - item.cascade.commissionPool - item.cascade.reinvest - item.cascade.tax, item.cascade.profitToDistribute);
});

test('investor item: gasto category COMISION SÍ se descuenta (a diferencia de la comisión)', () => {
  const v = {
    id: 'v3', plate: 'INV003', brand: 'Renault', model: 'Duster',
    saleDate: '2026-06-10T00:00:00Z', salePrice: 40_000_000,
    purchasePrice: 30_000_000, negotiatedValue: null, fromTradeIn: false,
    expenses: [{ amount: 500_000, category: 'COMISION', deletedAt: null }],
  };
  const item = buildInvestorVehicleItem({
    vehicle: v, payables: [mkInvestorPayable({ totalAmount: 9_500_000 })],
    commissionPayableSum: 0, bucketTransfers: [],
  });
  // A diferencia de calculateCommissionBase (excluye COMISION), la cascada de
  // ganancia SÍ resta todos los gastos no borrados (match con calculateSaleDistribution).
  assert.equal(item.cascade.directExpenses, 500_000);
  assert.equal(item.cascade.grossProfit, 9_500_000);
});

// ── resolveParticipants (equipo de reparto + resto al dueño) ─────
// Stub de prisma: los terceros consultados existen salvo los marcados.
const mkTx = (missingIds = []) => ({
  thirdParty: {
    findMany: async ({ where }) =>
      where.id.in.filter((id) => !missingIds.includes(id)).map((id) => ({ id })),
    findUnique: async ({ where }) =>
      missingIds.includes(where.id) ? null : { id: where.id },
  },
});

const CFG_LEGACY = { defaultCaptadorPct: 30, defaultCerradorPct: 70, defaultTeam: null };

test('reparto: participants explícitos suman <100 → fila owner por el resto', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'tp-vendedor', role: 'CAPTADOR', sharePct: 30 },
    { thirdPartyId: 'tp-papa', role: 'OTHER', sharePct: 15 },
    { thirdPartyId: 'tp-mama', role: 'OTHER', sharePct: 15 },
  ], CFG_LEGACY);
  assert.equal(out.length, 4);
  const owner = out.find((p) => p.thirdPartyId === 'owner-self');
  assert.equal(owner.sharePct, 40);
  assert.equal(owner.role, 'OTHER');
  assert.equal(out.reduce((s, p) => s + p.sharePct, 0), 100);
});

test('reparto: suma exactamente 100 → SIN fila owner', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 60 },
    { thirdPartyId: 'b', role: 'CERRADOR', sharePct: 40 },
  ], CFG_LEGACY);
  assert.equal(out.length, 2);
  assert.ok(!out.some((p) => p.thirdPartyId === 'owner-self'));
});

test('reparto: suma >100 → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'a', role: 'OTHER', sharePct: 70 },
      { thirdPartyId: 'b', role: 'OTHER', sharePct: 40 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: más de MAX_PARTICIPANTS → 400', async () => {
  const six = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => ({
    thirdPartyId: `tp-${i}`, role: 'OTHER', sharePct: 10,
  }));
  await assert.rejects(
    resolveParticipants(mkTx(), six, CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400 && /5/.test(e.message),
  );
});

test('reparto: thirdPartyId duplicado → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 20 },
      { thirdPartyId: 'a', role: 'OTHER', sharePct: 20 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400 && /repetid/i.test(e.message),
  );
});

test('reparto: owner-self en las filas → 400 (su parte es el resto)', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'owner-self', role: 'OTHER', sharePct: 40 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: sharePct <= 0 → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [{ thirdPartyId: 'a', role: 'OTHER', sharePct: 0 }], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: tercero inexistente → 400 con mensaje accionable', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(['tp-borrado']), [
      { thirdPartyId: 'tp-borrado', role: 'OTHER', sharePct: 20 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: hay resto al dueño pero owner-self no existe → error accionable, no FK crash', async () => {
  // Regresión: el centinela owner-self fue borrado de la DB. Al calcular el resto
  // del dueño, resolveParticipants debe fallar con mensaje claro ANTES de que
  // saleService intente crear la CxP y reviente con un FK (P2003) → 500 genérico.
  await assert.rejects(
    resolveParticipants(mkTx(['owner-self']), [
      { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 60 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && /owner-self/.test(e.message),
  );
});

test('reparto: hay resto al dueño y owner-self existe → incluye la fila del dueño', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 60 },
  ], CFG_LEGACY);
  assert.equal(out.find((p) => p.thirdPartyId === 'owner-self').sharePct, 40);
});

test('reparto: sin participants + equipo default → team + resto al dueño', async () => {
  const cfg = {
    ...CFG_LEGACY,
    defaultTeam: [
      { thirdPartyId: 'tp-vendedor', role: 'CAPTADOR', sharePct: 30 },
      { thirdPartyId: 'tp-papa', role: 'OTHER', sharePct: 15 },
    ],
  };
  const out = await resolveParticipants(mkTx(), undefined, cfg);
  assert.equal(out.length, 3);
  assert.equal(out.find((p) => p.thirdPartyId === 'owner-self').sharePct, 55);
});

test('reparto: equipo default con tercero borrado → 400 pidiendo actualizar Configuración', async () => {
  const cfg = { ...CFG_LEGACY, defaultTeam: [{ thirdPartyId: 'tp-borrado', role: 'OTHER', sharePct: 20 }] };
  await assert.rejects(
    resolveParticipants(mkTx(['tp-borrado']), undefined, cfg),
    (e) => e instanceof AppError && /Configuraci/i.test(e.message),
  );
});

test('reparto: sin participants y sin equipo → fallback legacy (owner captador+cerrador)', async () => {
  const out = await resolveParticipants(mkTx(), undefined, CFG_LEGACY);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.thirdPartyId === 'owner-self'));
  assert.deepEqual(out.map((p) => p.role).sort(), ['CAPTADOR', 'CERRADOR']);
  assert.equal(out.reduce((s, p) => s + p.sharePct, 0), 100);
});

test('reparto: decimales 33.33+33.33 → resto 33.34 y la lista suma exactamente 100', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'a', role: 'OTHER', sharePct: 33.33 },
    { thirdPartyId: 'b', role: 'OTHER', sharePct: 33.33 },
  ], CFG_LEGACY);
  const owner = out.find((p) => p.thirdPartyId === 'owner-self');
  assert.equal(owner.sharePct, 33.34);
  assert.equal(Math.round(out.reduce((s, p) => s + p.sharePct, 0) * 100) / 100, 100);
});

// ── resolveSellers / resolveInvestors (ganancia vs comisión) ─────

const CFG_DIST = { investorTeam: [
  { thirdPartyId: 'owner-self', sharePct: 50 },
  { thirdPartyId: 'mama', sharePct: 25 },
  { thirdPartyId: 'papa', sharePct: 25 },
] };

test('resolveSellers: un vendedor debe sumar 100', async () => {
  const out = await resolveSellers(mkTx(), [{ thirdPartyId: 'a', role: 'CERRADOR', sharePct: 100 }], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].sharePct, 100);
});

test('resolveSellers: sin vendedores → []', async () => {
  const out = await resolveSellers(mkTx(), [], {});
  assert.deepEqual(out, []);
});

test('resolveSellers: no suman 100 → 400', async () => {
  await assert.rejects(
    resolveSellers(mkTx(), [{ thirdPartyId: 'a', role: 'OTHER', sharePct: 60 }], {}),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('resolveInvestors: team válido → filas INVESTOR que suman 100', async () => {
  const out = await resolveInvestors(mkTx(), CFG_DIST);
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.role === 'INVESTOR'));
  assert.equal(out.reduce((s, r) => s + r.sharePct, 0), 100);
});

test('resolveInvestors: sin team → fallback owner-self 100', async () => {
  const out = await resolveInvestors(mkTx(), { investorTeam: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].thirdPartyId, 'owner-self');
  assert.equal(out[0].sharePct, 100);
});

test('resolveInvestors: team con owner-self borrado → error (ensureOwnerExists)', async () => {
  await assert.rejects(
    resolveInvestors(mkTx(['owner-self']), CFG_DIST),
    (e) => e instanceof AppError && /owner-self/.test(e.message),
  );
});

// ── loadCommissionConfig: parse defensivo del equipo ─────────────

// reinvest_share_pct/tax_share_pct (legacy, consumidos por calculatePools/
// saleService) se fijan DELIBERADAMENTE distintos de reinvest_pct/tax_pct
// (nuevos, sólo consumidos por distributionCfg) para poder probar que
// loadCommissionConfig no mezcla ambas fuentes.
const SETTING_ROWS = [
  { key: 'commission_share_pct', value: '60' },
  { key: 'reinvest_share_pct', value: '30' },
  { key: 'tax_share_pct', value: '10' },
  { key: 'default_captador_pct', value: '30' },
  { key: 'default_cerrador_pct', value: '70' },
  { key: 'reinvest_account_id', value: 'budget-reinvest' },
  { key: 'tax_reserve_account_id', value: 'budget-tax' },
  { key: 'commission_gross_pct', value: '10' },
  { key: 'reinvest_pct', value: '99' },
  { key: 'tax_pct', value: '88' },
];

const mkSettingsTx = (teamValue, investorTeamValue) => ({
  setting: {
    findMany: async () => [
      ...SETTING_ROWS,
      ...(teamValue === undefined ? [] : [{ key: 'commission_default_team', value: teamValue }]),
      ...(investorTeamValue === undefined ? [] : [{ key: 'investor_team', value: investorTeamValue }]),
    ],
  },
});

test('config: sin key de equipo → defaultTeam null (no exige la key)', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx(undefined));
  assert.equal(cfg.defaultTeam, null);
});

test('config: JSON corrupto → defaultTeam null (no tumba la venta)', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx('{{{no-json'));
  assert.equal(cfg.defaultTeam, null);
});

test('config: JSON válido pero no-array o vacío → defaultTeam null', async () => {
  assert.equal((await loadCommissionConfig(mkSettingsTx('{}'))).defaultTeam, null);
  assert.equal((await loadCommissionConfig(mkSettingsTx('[]'))).defaultTeam, null);
});

test('config: array válido → defaultTeam parseado', async () => {
  const team = [{ thirdPartyId: 'x', role: 'OTHER', sharePct: 20 }];
  const cfg = await loadCommissionConfig(mkSettingsTx(JSON.stringify(team)));
  assert.deepEqual(cfg.defaultTeam, team);
});

test('config: distributionCfg mapea commissionGrossPct/reinvestPct/taxPct desde las keys nuevas', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx());
  assert.deepEqual(cfg.distributionCfg, {
    commissionGrossPct: 10,
    reinvestPct: 99,
    taxPct: 88,
  });
});

test('REGRESIÓN: reinvestPct/taxPct top-level siguen viniendo de las keys viejas (no de las nuevas)', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx());
  // Fixture: reinvest_share_pct=30/tax_share_pct=10 (viejas) vs reinvest_pct=99/tax_pct=88 (nuevas).
  assert.equal(cfg.reinvestPct, 30);
  assert.equal(cfg.taxPct, 10);
  assert.notEqual(cfg.reinvestPct, cfg.distributionCfg.reinvestPct);
  assert.notEqual(cfg.taxPct, cfg.distributionCfg.taxPct);
});

test('config: investorTeam — JSON array válido se parsea', async () => {
  const team = [{ thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 100 }];
  const cfg = await loadCommissionConfig(mkSettingsTx(undefined, JSON.stringify(team)));
  assert.deepEqual(cfg.investorTeam, team);
});

test('config: investorTeam — JSON corrupto → [] (no tumba la venta)', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx(undefined, '{{{no-json'));
  assert.deepEqual(cfg.investorTeam, []);
});

test('config: investorTeam — JSON válido pero no-array → []', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx(undefined, '{"foo":"bar"}'));
  assert.deepEqual(cfg.investorTeam, []);
});

test('config: investorTeam — sin key → [] (default)', async () => {
  const cfg = await loadCommissionConfig(mkSettingsTx());
  assert.deepEqual(cfg.investorTeam, []);
});

// ── buildPersonSummary (métricas por persona) ────────────────────
const { buildPersonSummary } = require('../commissionService');

test('summary: agrega por persona con pagado, pendiente y # ventas distintas', () => {
  const rows = [
    { thirdPartyId: 'v', thirdPartyName: 'Vendedor', vehicleId: 'car1', status: 'PAID', totalAmount: 900_000, paidAmount: 900_000 },
    { thirdPartyId: 'v', thirdPartyName: 'Vendedor', vehicleId: 'car2', status: 'PENDING', totalAmount: 600_000, paidAmount: 0 },
    { thirdPartyId: 'p', thirdPartyName: 'Papá', vehicleId: 'car1', status: 'PARTIAL', totalAmount: 450_000, paidAmount: 200_000 },
  ];
  const out = buildPersonSummary(rows);
  const v = out.find((x) => x.thirdParty.id === 'v');
  assert.equal(v.totalPaid, 900_000);
  assert.equal(v.totalPending, 600_000);
  assert.equal(v.salesCount, 2);
  const p = out.find((x) => x.thirdParty.id === 'p');
  assert.equal(p.totalPending, 250_000);
  // Orden: mayor pendiente primero
  assert.equal(out[0].thirdParty.id, 'v');
});

test('summary: CANCELLED no suma pendiente pero sí lo ya pagado', () => {
  const rows = [
    { thirdPartyId: 'v', thirdPartyName: 'V', vehicleId: 'c1', status: 'CANCELLED', totalAmount: 500_000, paidAmount: 100_000 },
  ];
  const out = buildPersonSummary(rows);
  assert.equal(out[0].totalPending, 0);
  assert.equal(out[0].totalPaid, 100_000);
});

test('summary: sin filas → lista vacía', () => {
  assert.deepEqual(buildPersonSummary([]), []);
});
