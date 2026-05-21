// ═══════════════════════════════════════════════════════════════
// Observabilidad — Sentry (env-gated)
// Si no hay SENTRY_DSN, todo es no-op: la app funciona igual sin monitoreo.
// Con SENTRY_DSN definido, se captura cada error de servidor (5xx).
// ═══════════════════════════════════════════════════════════════

let sentry = null;
let enabled = false;

/**
 * Inicializa Sentry solo si SENTRY_DSN está definido. Devuelve true si quedó activo.
 * Seguro ante ausencia del paquete o errores de init: nunca tumba el arranque.
 */
function initSentry(env = process.env) {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    // require perezoso: solo se carga el SDK cuando hay DSN.
    sentry = require('@sentry/node');
    sentry.init({
      dsn,
      environment: env.NODE_ENV || 'development',
      tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    enabled = true;
    return true;
  } catch (err) {
    // No romper la app si Sentry falla al inicializar.
    console.error('Sentry no pudo inicializarse:', err.message);
    enabled = false;
    return false;
  }
}

/** Envía un error a Sentry si está activo. No-op (y nunca lanza) en caso contrario. */
function captureError(err) {
  if (!enabled || !sentry) return;
  try {
    sentry.captureException(err);
  } catch {
    /* nunca interrumpir el flujo de la request por un fallo de telemetría */
  }
}

function isSentryEnabled() {
  return enabled;
}

module.exports = { initSentry, captureError, isSentryEnabled };
