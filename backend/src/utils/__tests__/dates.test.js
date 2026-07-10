// Unit tests del bucketing diario en zona horaria del negocio (Bogotá).
// Auditoría 🟡 #13: bucketizar por UTC desplazaba los movimientos de la noche
// (19:00-23:59 en Colombia) al día siguiente en la gráfica de cash-flow.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dayKeyBogota, BUSINESS_TIMEZONE } = require('../dates');

test('dayKeyBogota: la noche colombiana pertenece a SU día, no al siguiente UTC', () => {
  // 22:00 en Bogotá del 7-jul = 03:00 UTC del 8-jul
  assert.equal(dayKeyBogota('2026-07-08T03:00:00Z'), '2026-07-07');
});

test('dayKeyBogota: mediodía queda en el mismo día', () => {
  assert.equal(dayKeyBogota('2026-07-08T12:00:00Z'), '2026-07-08');
});

test('dayKeyBogota: la frontera de medianoche Bogotá (05:00 UTC) cambia de día', () => {
  assert.equal(dayKeyBogota('2026-07-08T04:59:59Z'), '2026-07-07');
  assert.equal(dayKeyBogota('2026-07-08T05:00:00Z'), '2026-07-08');
});

test('dayKeyBogota: acepta Date y string; formato YYYY-MM-DD', () => {
  assert.match(dayKeyBogota(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test('BUSINESS_TIMEZONE es la zona del negocio', () => {
  assert.equal(BUSINESS_TIMEZONE, 'America/Bogota');
});
