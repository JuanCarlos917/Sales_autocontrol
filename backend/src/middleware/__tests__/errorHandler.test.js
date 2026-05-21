const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, errorHandler, notFoundHandler } = require('../errorHandler');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const req = { method: 'GET', originalUrl: '/x' };

// Ejecuta fn silenciando console.error y devuelve cuántas veces se llamó.
function countServerLogs(fn) {
  const orig = console.error;
  let calls = 0;
  console.error = () => { calls += 1; };
  try { fn(); } finally { console.error = orig; }
  return calls;
}

test('errorHandler: AppError operacional usa su status y mensaje, y no se loguea como error de servidor', () => {
  const res = mockRes();
  const logs = countServerLogs(() => errorHandler(new AppError('No autorizado', 403), req, res, () => {}));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'No autorizado');
  assert.equal(logs, 0);
});

test('errorHandler: error no operacional → 500 genérico (no filtra detalle) y se loguea', () => {
  const res = mockRes();
  const logs = countServerLogs(() => errorHandler(new Error('detalle interno secreto'), req, res, () => {}));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Error interno del servidor');
  assert.equal(logs, 1);
});

test('errorHandler: Prisma P2002 → 409 duplicado (sin loguear como server error)', () => {
  const res = mockRes();
  const logs = countServerLogs(() => errorHandler({ code: 'P2002', meta: { target: ['plate'] } }, req, res, () => {}));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /duplicado/i);
  assert.equal(logs, 0);
});

test('errorHandler: Prisma P2025 → 404', () => {
  const res = mockRes();
  errorHandler({ code: 'P2025' }, req, res, () => {});
  assert.equal(res.statusCode, 404);
});

test('notFoundHandler → 404 con método y ruta', () => {
  const res = mockRes();
  notFoundHandler({ method: 'GET', originalUrl: '/nope' }, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /no encontrada/i);
});
