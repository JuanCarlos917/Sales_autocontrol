const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findInsecureConfig, assertSecureConfig } = require('../validateConfig');

// Fixtures de entorno con valores de baja entropía (no son credenciales reales).
const strongEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ADMIN_PASSWORD: 'c'.repeat(16),
  ADMIN_PIN: '012345',
};

test('findInsecureConfig: entorno vacío reporta todo lo faltante', () => {
  const problems = findInsecureConfig({});
  assert.ok(problems.length >= 4);
  assert.ok(problems.some((p) => /JWT_SECRET/.test(p)));
  assert.ok(problems.some((p) => /JWT_REFRESH_SECRET/.test(p)));
  assert.ok(problems.some((p) => /ADMIN_PASSWORD/.test(p)));
  assert.ok(problems.some((p) => /ADMIN_PIN/.test(p)));
});

test('findInsecureConfig: entorno fuerte no reporta problemas', () => {
  assert.deepEqual(findInsecureConfig(strongEnv), []);
});

test('findInsecureConfig: secreto demasiado corto se reporta', () => {
  const problems = findInsecureConfig({ ...strongEnv, JWT_SECRET: 'x'.repeat(10) });
  assert.ok(problems.some((p) => /JWT_SECRET/.test(p)));
});

test('findInsecureConfig: secretos iguales se reportan', () => {
  const same = 'z'.repeat(40);
  const problems = findInsecureConfig({ ...strongEnv, JWT_SECRET: same, JWT_REFRESH_SECRET: same });
  assert.ok(problems.some((p) => /distintos/.test(p)));
});

test('findInsecureConfig: PIN corto (4 dígitos) se reporta', () => {
  const problems = findInsecureConfig({ ...strongEnv, ADMIN_PIN: '1234' });
  assert.ok(problems.some((p) => /ADMIN_PIN/.test(p)));
});

test('assertSecureConfig: no lanza fuera de producción aunque falte todo', () => {
  assert.doesNotThrow(() => assertSecureConfig({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertSecureConfig({ NODE_ENV: 'test' }));
});

test('assertSecureConfig: lanza en producción con entorno inseguro', () => {
  assert.throws(() => assertSecureConfig({ NODE_ENV: 'production' }), /Configuración insegura/);
});

test('assertSecureConfig: no lanza en producción con entorno fuerte', () => {
  assert.doesNotThrow(() => assertSecureConfig(strongEnv));
});
