import { describe, it, expect } from 'vitest';
import { groupByMonth, sumRolesTotal, saleDateOf } from './monthGrouping';

const item = (saleDate, roles) => ({ vehicle: { saleDate }, roles });

describe('sumRolesTotal', () => {
  it('suma los totales de roles no cancelados', () => {
    const it1 = item('2026-08-10', [
      { total: 300, status: 'PAID' },
      { total: 700, status: 'PENDING' },
      { total: 999, status: 'CANCELLED' },
    ]);
    expect(sumRolesTotal(it1)).toBe(1000);
  });

  it('devuelve 0 sin roles', () => {
    expect(sumRolesTotal({ vehicle: {}, roles: [] })).toBe(0);
    expect(sumRolesTotal({ vehicle: {} })).toBe(0);
  });
});

describe('saleDateOf', () => {
  it('lee vehicle.saleDate y tolera ausencia', () => {
    expect(saleDateOf(item('2026-08-10', []))).toBe('2026-08-10');
    expect(saleDateOf({})).toBe(null);
  });
});

describe('groupByMonth', () => {
  const opts = { dateOf: saleDateOf, sumOf: sumRolesTotal };

  it('devuelve [] con lista vacía', () => {
    expect(groupByMonth([], opts)).toEqual([]);
  });

  it('agrupa por mes con count y subtotal', () => {
    const items = [
      item('2026-08-10', [{ total: 1000, status: 'PENDING' }]),
      item('2026-08-25', [{ total: 500, status: 'PAID' }]),
      item('2026-07-05', [{ total: 300, status: 'PAID' }]),
    ];
    const groups = groupByMonth(items, opts);
    expect(groups).toHaveLength(2);
    const aug = groups.find((g) => g.monthKey === '2026-08');
    expect(aug.count).toBe(2);
    expect(aug.subtotal).toBe(1500);
    expect(aug.monthLabel).toBe('Agosto 2026');
  });

  it('ordena los meses descendente', () => {
    const items = [
      item('2026-06-01', [{ total: 1, status: 'PAID' }]),
      item('2026-08-01', [{ total: 1, status: 'PAID' }]),
      item('2026-07-01', [{ total: 1, status: 'PAID' }]),
    ];
    const keys = groupByMonth(items, opts).map((g) => g.monthKey);
    expect(keys).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('ordena los ítems dentro del mes por fecha descendente', () => {
    const items = [
      item('2026-08-05', [{ total: 1, status: 'PAID' }]),
      item('2026-08-28', [{ total: 1, status: 'PAID' }]),
    ];
    const aug = groupByMonth(items, opts)[0];
    expect(aug.items.map((i) => i.vehicle.saleDate)).toEqual(['2026-08-28', '2026-08-05']);
  });

  it('coloca los ítems sin fecha en un bucket al final', () => {
    const items = [
      item(null, [{ total: 1, status: 'PAID' }]),
      item('2026-08-01', [{ total: 1, status: 'PAID' }]),
    ];
    const groups = groupByMonth(items, opts);
    expect(groups[groups.length - 1].monthKey).toBe('sin-fecha');
    expect(groups[groups.length - 1].monthLabel).toBe('Sin fecha');
  });

  it('no muta la lista de entrada', () => {
    const items = [
      item('2026-08-05', [{ total: 1, status: 'PAID' }]),
      item('2026-08-28', [{ total: 1, status: 'PAID' }]),
    ];
    const snapshot = items.map((i) => i.vehicle.saleDate);
    groupByMonth(items, opts);
    expect(items.map((i) => i.vehicle.saleDate)).toEqual(snapshot);
  });
});
