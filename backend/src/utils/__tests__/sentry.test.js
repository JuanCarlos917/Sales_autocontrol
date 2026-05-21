const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initSentry, captureError, isSentryEnabled } = require('../sentry');

test('initSentry: sin SENTRY_DSN queda desactivado (no-op)', () => {
  const active = initSentry({ NODE_ENV: 'production' }); // sin SENTRY_DSN
  assert.equal(active, false);
  assert.equal(isSentryEnabled(), false);
});

test('captureError: no lanza cuando Sentry está desactivado', () => {
  assert.doesNotThrow(() => captureError(new Error('algo')));
});
