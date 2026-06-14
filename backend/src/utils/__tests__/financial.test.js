// Unit tests para los cálculos financieros del negocio (núcleo contable).
// Runner: node:test (incluido en Node 18+), sin dependencias extra.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  daysBetween,
  calculateVehicleMetrics,
  projectProfit,
  calculateParticipation,
} = require('../financial');

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ── daysBetween ──────────────────────────────────────────────
test('daysBetween: sin fecha inicial devuelve 0', () => {
  assert.equal(daysBetween(null), 0);
  assert.equal(daysBetween(undefined), 0);
});

test('daysBetween: cuenta días exactos entre dos fechas', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
});

test('daysBetween: nunca es negativo (fin antes de inicio)', () => {
  assert.equal(daysBetween('2026-02-01', '2026-01-01'), 0);
});

// ── calculateParticipation ───────────────────────────────────
test('calculateParticipation: precio <= 0 → 1', () => {
  assert.equal(calculateParticipation(0, 5_000_000), 1);
  assert.equal(calculateParticipation(null, 5_000_000), 1);
});

test('calculateParticipation: sin aporte de socio → 1', () => {
  assert.equal(calculateParticipation(20_000_000, 0), 1);
});

test('calculateParticipation: aporte >= precio → 0', () => {
  assert.equal(calculateParticipation(20_000_000, 20_000_000), 0);
  assert.equal(calculateParticipation(20_000_000, 25_000_000), 0);
});

test('calculateParticipation: proporción normal (precio-aporte)/precio', () => {
  approx(calculateParticipation(20_000_000, 8_000_000), 0.6);
});

// ── calculateVehicleMetrics ──────────────────────────────────
test('métricas: categoriza gastos y calcula no pagados (sin comisiones legacy)', () => {
  // La categoría COMISION fue eliminada del enum. Ahora las comisiones
  // se modelan vía commissionPayables (3er parámetro), no como expenses.
  const v = {
    expenses: [
      { amount: 1_000_000, category: 'MECANICA', paid: true },
      { amount: 300_000, category: 'ESTETICA', paid: true },
      { amount: 200_000, category: 'IMPUESTOS', paid: true },
      { amount: 100_000, category: 'TRAMITE', paid: false },
    ],
  };
  const m = calculateVehicleMetrics(v);
  assert.equal(m.totalExpenses, 1_600_000);
  assert.equal(m.repairs, 1_300_000); // MECANICA + ESTETICA
  assert.equal(m.commissions, 0);     // ya no se calculan desde expenses
  assert.equal(m.commissionTotal, 0);
  assert.equal(m.taxes, 300_000);     // IMPUESTOS + TRAMITE
  assert.equal(m.unpaidExpenses, 100_000); // TRAMITE
  assert.equal(m.expenseCount, 4);
});

test('métricas: comisiones desde commissionPayables, descuenta solo lo pagado', () => {
  // Venta 30M - compra 20M = ganancia 10M. Comisión pool 60% = 6M.
  // Captador 30% = 1.8M (pagado), Cerrador 70% = 4.2M (pendiente).
  // netProfit debe restar solo lo PAGADO (1.8M), no el total.
  const v = {
    stage: 'VENDIDO',
    purchasePrice: 20_000_000,
    salePrice: 30_000_000,
    expenses: [],
    // sin purchaseDate → 0 días fijo
  };
  const payables = [
    { totalAmount: 1_800_000, paidAmount: 1_800_000, saleParticipant: { role: 'CAPTADOR' } },
    { totalAmount: 4_200_000, paidAmount: 0,         saleParticipant: { role: 'CERRADOR' } },
  ];
  const m = calculateVehicleMetrics(v, 800_000, payables);
  assert.equal(m.commissionTotal, 6_000_000);
  assert.equal(m.commissionPaid, 1_800_000);
  assert.equal(m.commissionPending, 4_200_000);
  assert.equal(m.commissionCaptador, 1_800_000);
  assert.equal(m.commissionCerrador, 4_200_000);
  // netProfit = 30M - 20M (sin gastos ni fijo) - 1.8M pagado = 8.2M
  assert.equal(m.netProfit, 8_200_000);
});

test('métricas: comisión pendiente NO descuenta netProfit', () => {
  const v = { stage: 'VENDIDO', purchasePrice: 20_000_000, salePrice: 30_000_000, expenses: [] };
  const payables = [
    { totalAmount: 6_000_000, paidAmount: 0, saleParticipant: { role: 'CERRADOR' } },
  ];
  const m = calculateVehicleMetrics(v, 800_000, payables);
  assert.equal(m.commissionPaid, 0);
  assert.equal(m.commissionPending, 6_000_000);
  assert.equal(m.netProfit, 10_000_000); // pendiente NO descuenta
});

test('métricas: sin precio de referencia → sin ganancia', () => {
  const m = calculateVehicleMetrics({ stage: 'COMPRADO', purchasePrice: 10_000_000, expenses: [] });
  assert.equal(m.netProfit, null);
  assert.equal(m.myProfit, null);
  assert.equal(m.isProjectedProfit, false);
});

test('métricas: no vendido con precio publicado → ganancia proyectada', () => {
  const m = calculateVehicleMetrics({
    stage: 'PUBLICADO',
    purchasePrice: 10_000_000,
    listedPrice: 13_000_000,
    expenses: [],
    // sin purchaseDate → días en inventario 0 → fijo prorrateado 0
  });
  assert.equal(m.daysInInventory, 0);
  assert.equal(m.fixedProrated, 0);
  assert.equal(m.realCostWithFixed, 10_000_000);
  assert.equal(m.netProfit, 3_000_000);
  assert.equal(m.isProjectedProfit, true);
  assert.equal(m.myProfit, 3_000_000);
});

test('métricas: vendido sin socio → ganancia real con gasto fijo prorrateado', () => {
  const m = calculateVehicleMetrics({
    stage: 'VENDIDO',
    purchasePrice: 20_000_000,
    salePrice: 25_000_000,
    purchaseDate: '2026-01-01',
    saleDate: '2026-01-31', // 30 días → fijo = fixedMonthly
    expenses: [
      { amount: 1_000_000, category: 'MECANICA', paid: true },
      { amount: 500_000, category: 'OTRO', paid: false }, // antes COMISION (eliminada)
    ],
  }); // fixedMonthly default 800_000
  assert.equal(m.daysInInventory, 30);
  assert.equal(m.fixedProrated, 800_000);
  assert.equal(m.realCost, 21_500_000);
  assert.equal(m.realCostWithFixed, 22_300_000);
  assert.equal(m.netProfit, 2_700_000);
  assert.equal(m.isProjectedProfit, false);
  assert.equal(m.myProfit, 2_700_000);
  assert.equal(m.partnerProfit, 0);
  assert.equal(m.myCapital, 20_000_000);
});

test('métricas: socio pro-rata (asume gastos) reparte la ganancia neta por participación', () => {
  const m = calculateVehicleMetrics({
    stage: 'VENDIDO',
    purchasePrice: 10_000_000,
    salePrice: 15_000_000,
    purchaseDate: '2026-01-01',
    saleDate: '2026-01-01', // 0 días
    participation: 0.6,
    partnerContribution: 4_000_000,
    partnerAssumesExpenses: true,
    expenses: [{ amount: 1_000_000, category: 'IMPUESTOS', paid: true }],
  });
  assert.equal(m.netProfit, 4_000_000); // 15M - (10M + 1M)
  assert.equal(m.myProfit, 2_400_000); // 4M * 0.6
  assert.equal(m.partnerProfit, 1_600_000); // 4M * 0.4
  assert.equal(m.myCapital, 6_000_000); // 10M - 4M
});

test('métricas: socio NO asume gastos → recibe % sobre ganancia bruta, yo absorbo los gastos', () => {
  const m = calculateVehicleMetrics({
    stage: 'VENDIDO',
    purchasePrice: 10_000_000,
    salePrice: 16_000_000,
    purchaseDate: '2026-01-01',
    saleDate: '2026-01-01',
    participation: 0.5,
    partnerAssumesExpenses: false,
    expenses: [{ amount: 2_000_000, category: 'MECANICA', paid: true }],
  });
  // neto = 16M - (10M + 2M) = 4M ; bruto = 16M - 10M = 6M
  assert.equal(m.netProfit, 4_000_000);
  assert.equal(m.partnerProfit, 3_000_000); // 6M * 0.5 (sobre bruto)
  assert.equal(m.myProfit, 1_000_000); // 4M - 3M (yo absorbo los gastos)
});

test('métricas: gastos soft-deleted NO cuentan en el P&L (ej. reclasificados a crédito)', () => {
  const v = {
    expenses: [
      { amount: 1_000_000, category: 'MECANICA', paid: true },
      { amount: 1_500_000, category: 'OTRO', paid: true, deletedAt: '2026-06-13T00:00:00.000Z' },
    ],
  };
  const m = calculateVehicleMetrics(v);
  assert.equal(m.totalExpenses, 1_000_000); // el soft-deleted (1.5M) no suma
  assert.equal(m.expenseCount, 1);
});

// ── projectProfit ────────────────────────────────────────────
test('projectProfit: costo, ganancia y ROI con gasto fijo prorrateado', () => {
  const p = projectProfit({
    purchasePrice: 10_000_000,
    estimatedExpenses: 1_000_000,
    salePrice: 14_000_000,
    estimatedDays: 30,
  }); // fixedMonthly default 800_000
  assert.equal(p.fixedProrated, 800_000);
  assert.equal(p.totalCost, 11_800_000);
  assert.equal(p.netProfit, 2_200_000);
  assert.equal(p.myProfit, 2_200_000);
  approx(p.roi, 2_200_000 / 11_800_000);
});

test('projectProfit: con participación, mi ganancia es proporcional', () => {
  const p = projectProfit({
    purchasePrice: 10_000_000,
    estimatedExpenses: 0,
    salePrice: 14_000_000,
    estimatedDays: 0,
    participation: 0.5,
  });
  assert.equal(p.netProfit, 4_000_000);
  assert.equal(p.myProfit, 2_000_000);
});

const {
  calculateCommissionBase,
} = require('../financial');

// ── calculateCommissionBase ─────────────────────────────────
test('calculateCommissionBase: vehículo sin socio, ganancia positiva', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [
      { category: 'MECANICA', amount: 500_000 },
      { category: 'ESTETICA', amount: 500_000 },
    ],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_000_000);
  assert.equal(r.commissionBase, 9_000_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: vehículo con socio 50%, base = mi parte', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [{ category: 'MECANICA', amount: 1_000_000 }],
    participation: 0.5,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_000_000);
  assert.equal(r.commissionBase, 4_500_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: pérdida → skip true, base 0', () => {
  const v = {
    salePrice: 25_000_000,
    purchasePrice: 30_000_000,
    expenses: [],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.commissionBase, 0);
  assert.equal(r.skip, true);
});

test('calculateCommissionBase: fromTradeIn usa negotiatedValue como purchasePrice', () => {
  const v = {
    salePrice: 25_000_000,
    purchasePrice: null,
    negotiatedValue: 17_500_000,
    expenses: [],
    participation: 1,
    fromTradeIn: true,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 7_500_000);
  assert.equal(r.commissionBase, 7_500_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: expenses categoría COMISION quedan excluidos', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [
      { category: 'MECANICA', amount: 500_000 },
      { category: 'COMISION', amount: 2_000_000 }, // legacy, no debe restar
    ],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_500_000);
});

test('calculateCommissionBase: sin purchasePrice (NULL) → skip true', () => {
  // Caso producción: vehículo TES3232 que se vendió en 20M sin tener precio
  // de compra registrado. Sin este guard, el cálculo trataba el costo como 0
  // y cobraba comisión sobre todo el salePrice como si fuera ganancia pura.
  const v = {
    salePrice: 20_000_000,
    purchasePrice: null,
    expenses: [],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.commissionBase, 0);
  assert.equal(r.skip, true);
});

test('calculateCommissionBase: purchasePrice = 0 también es skip', () => {
  const v = {
    salePrice: 20_000_000,
    purchasePrice: 0,
    expenses: [],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.skip, true);
});

test('calculateCommissionBase: fromTradeIn sin negotiatedValue → skip true', () => {
  const v = {
    salePrice: 25_000_000,
    purchasePrice: null,
    negotiatedValue: null,
    expenses: [],
    participation: 1,
    fromTradeIn: true,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.skip, true);
});

const {
  roundCop,
  calcLoanInterest,
  splitLoanPayment,
  splitFinalPayment,
} = require('../financial');

// ── roundCop ─────────────────────────────────────────────────
test('roundCop: redondea a entero (COP sin decimales)', () => {
  assert.equal(roundCop(1000.4), 1000);
  assert.equal(roundCop(1000.5), 1001);
  assert.equal(roundCop(0), 0);
});

// ── calcLoanInterest ─────────────────────────────────────────
test('calcLoanInterest: 10% de 10M = 1M', () => {
  assert.equal(calcLoanInterest(10_000_000, 10), 1_000_000);
});

test('calcLoanInterest: tasa 0 o nula = 0', () => {
  assert.equal(calcLoanInterest(10_000_000, 0), 0);
  assert.equal(calcLoanInterest(10_000_000, null), 0);
});

test('calcLoanInterest: redondea a entero', () => {
  assert.equal(calcLoanInterest(3_333_333, 10), 333_333);
});

// ── splitLoanPayment ─────────────────────────────────────────
test('splitLoanPayment: reparte proporcional capital/interés', () => {
  // total 11M, interés 1M => 9.0909% interés
  const r = splitLoanPayment(1_100_000, 1_000_000, 11_000_000);
  assert.equal(r.interestPortion, 100_000);
  assert.equal(r.capitalPortion, 1_000_000);
});

test('splitLoanPayment: sin interés todo es capital', () => {
  const r = splitLoanPayment(500_000, 0, 5_000_000);
  assert.equal(r.interestPortion, 0);
  assert.equal(r.capitalPortion, 500_000);
});

test('splitLoanPayment: capital + interés siempre suman el abono', () => {
  const r = splitLoanPayment(777_777, 1_000_000, 11_000_000);
  assert.equal(r.capitalPortion + r.interestPortion, 777_777);
});

// ── splitFinalPayment (pago que salda) ───────────────────────
test('splitFinalPayment: cierra el interés remanente normal', () => {
  const r = splitFinalPayment(5_500_000, 500_000);
  assert.equal(r.interestPortion, 500_000);
  assert.equal(r.capitalPortion, 5_000_000);
});

test('splitFinalPayment: nunca produce capital negativo (pago < interés remanente)', () => {
  const r = splitFinalPayment(1, 2);
  assert.equal(r.interestPortion, 1);
  assert.equal(r.capitalPortion, 0);
});

test('splitFinalPayment: interés remanente negativo se trata como 0', () => {
  const r = splitFinalPayment(1000, -5);
  assert.equal(r.interestPortion, 0);
  assert.equal(r.capitalPortion, 1000);
});

test('splitFinalPayment: capital + interés siempre suman el pago', () => {
  const r = splitFinalPayment(777, 1_000_000);
  assert.equal(r.capitalPortion + r.interestPortion, 777);
  assert.ok(r.capitalPortion >= 0 && r.interestPortion >= 0);
});
