// ═══════════════════════════════════════════════════════════════
// Server — Entry Point
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const { assertSecureConfig } = require('./config/validateConfig');
const { initSentry } = require('./utils/sentry');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Fail fast: en producción no se arranca con secretos/credenciales por defecto o débiles.
try {
  assertSecureConfig(process.env);
} catch (err) {
  console.error(`\n  ❌ ${err.message}\n`);
  process.exit(1);
}

// Observabilidad: monitoreo de errores (solo si hay SENTRY_DSN).
const sentryActive = initSentry(process.env);

const app = express();

// Detrás de un proxy (Caddy): confía en 1 salto para que `req.ip` sea la IP real
// del cliente (vía X-Forwarded-For). Sin esto, el rate limiter cuenta todo el
// tráfico contra la IP del proxy y el cupo se agota para todos a la vez.
// Se usa el número de saltos (no `true`) para que el cliente no pueda falsear la IP.
app.set('trust proxy', 1);

// ── Security ──
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin.split(',').map(s => s.trim()),
  credentials: true,
}));

// ── Rate Limiting (disabled in development and test) ──
if (!['development', 'test'].includes(config.nodeEnv)) {
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: { error: 'Demasiadas solicitudes, intenta más tarde' },
  });
  app.use('/api/', limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Demasiadas solicitudes de autenticación, intenta más tarde' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/pin-login', authLimiter);
}

// ── Parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ──
if (config.nodeEnv !== 'test') {
  app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
}

// ── Static Files (uploads) ──
app.use('/uploads', express.static(config.upload.dir));

// ── API Routes ──
app.use('/api', routes);

// ── Error Handling ──
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start Server ──
const server = app.listen(config.port, () => {
  console.log(`\n  🚗 AutoControl API running`);
  console.log(`  📡 Port: ${config.port}`);
  console.log(`  🌍 Env: ${config.nodeEnv}`);
  console.log(`  📁 Uploads: ${config.upload.dir}`);
  console.log(`  🛰️  Sentry: ${sentryActive ? 'activo' : 'desactivado (sin SENTRY_DSN)'}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

module.exports = app;
