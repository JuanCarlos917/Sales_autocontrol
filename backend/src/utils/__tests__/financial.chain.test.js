'use strict';
// Tests — cascada con base de cadena (negocio con cruce).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateChainGrossProfit, calculateSaleDistribution } = require('../financial');

const CFG = { commissionGrossPct: 10, reinvestPct: 30, taxPct: 10 };
const SELLERS = [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }];
const INVESTORS = [{ thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 100 }];

test('calculateChainGrossProfit: suma eslabones; negotiatedValue como costo de fromTradeIn', () => {
  const members = [
    { plate: 'AAA111', salePrice: 50_000_000, purchasePrice: 40_000_000, fromTradeIn: false, negotiatedValue: null, expenses: [] },
    { plate: 'BBB222', salePrice: 25_000_000, purchasePrice: null, fromTradeIn: true, negotiatedValue: 20_000_000,
      expenses: [{ amount: 1_000_000, deletedAt: null }] },
  ];
  const r = calculateChainGrossProfit(members);
  assert.equal(r.salePrice, 75_000_000);
  assert.equal(r.purchaseCost, 60_000_000);
  assert.equal(r.directExpenses, 1_000_000);
  assert.equal(r.grossProfit, 14_000_000);
  assert.deepEqual(r.plates, ['AAA111', 'BBB222']);
});

test('calculateChainGrossProfit: gastos con deletedAt no cuentan; sin miembros → ceros', () => {
  const r = calculateChainGrossProfit([
    { plate: 'X', salePrice: 10, purchasePrice: 5, fromTradeIn: false,
      expenses: [{ amount: 3, deletedAt: new Date() }] },
  ]);
  assert.equal(r.grossProfit, 5);
  const empty = calculateChainGrossProfit([]);
  assert.equal(empty.grossProfit, 0);
  assert.deepEqual(empty.plates, []);
});

test('calculateSaleDistribution: overrideGrossProfit reemplaza la base del vehículo', () => {
  // Vehículo de cierre: su propia venta daría 4M, pero el negocio da 14M.
  const vehicle = { salePrice: 25_000_000, purchasePrice: null, negotiatedValue: 20_000_000,
    fromTradeIn: true, expenses: [{ amount: 1_000_000, deletedAt: null }] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 14_000_000,
  });
  assert.equal(dist.skip, false);
  assert.equal(dist.grossProfit, 14_000_000);
  assert.equal(dist.commissionPool, 1_400_000);
  assert.equal(dist.afterCommission, 12_600_000);
  assert.equal(dist.reinvestAmount, 3_780_000);
  assert.equal(dist.taxAmount, 1_260_000);
  assert.equal(dist.profitToDistribute, 7_560_000);
});

test('calculateSaleDistribution: overrideGrossProfit ignora el guard purchaseCost<=0 del vehículo', () => {
  // Cierre de un cruce sin purchasePrice propio: el guard individual no aplica.
  const vehicle = { salePrice: 25_000_000, purchasePrice: null, negotiatedValue: null,
    fromTradeIn: true, expenses: [] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 5_000_000,
  });
  assert.equal(dist.skip, false);
  assert.equal(dist.commissionPool, 500_000);
});

test('calculateSaleDistribution: overrideGrossProfit <= 0 → skip', () => {
  const vehicle = { salePrice: 25_000_000, purchasePrice: 20_000_000, fromTradeIn: false, expenses: [] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 0,
  });
  assert.equal(dist.skip, true);
  assert.equal(dist.commissionPool, 0);
});

test('calculateSaleDistribution: sin override, comportamiento intacto (regresión)', () => {
  const vehicle = { salePrice: 25_000_000, purchasePrice: 20_000_000, fromTradeIn: false,
    expenses: [{ amount: 1_000_000, deletedAt: null }] };
  const dist = calculateSaleDistribution(vehicle, CFG, { sellers: SELLERS, investors: INVESTORS });
  assert.equal(dist.grossProfit, 4_000_000);
  assert.equal(dist.commissionPool, 400_000);
});
