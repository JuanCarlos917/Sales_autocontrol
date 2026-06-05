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
test('métricas: categoriza gastos y calcula no pagados', () => {
  const v = {
    expenses: [
      { amount: 1_000_000, category: 'MECANICA', paid: true },
      { amount: 300_000, category: 'ESTETICA', paid: true },
      { amount: 500_000, category: 'COMISION', paid: false },
      { amount: 200_000, category: 'IMPUESTOS', paid: true },
      { amount: 100_000, category: 'TRAMITE', paid: false },
    ],
  };
  const m = calculateVehicleMetrics(v);
  assert.equal(m.totalExpenses, 2_100_000);
  assert.equal(m.repairs, 1_300_000); // MECANICA + ESTETICA
  assert.equal(m.commissions, 500_000); // COMISION
  assert.equal(m.taxes, 300_000); // IMPUESTOS + TRAMITE
  assert.equal(m.unpaidExpenses, 600_000); // COMISION + TRAMITE
  assert.equal(m.expenseCount, 5);
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
      { amount: 500_000, category: 'COMISION', paid: false },
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
