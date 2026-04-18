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
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── Security ──
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin.split(',').map(s => s.trim()),
  credentials: true,
}));

// ── Rate Limiting (disabled in development) ──
if (config.nodeEnv !== 'development') {
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
  console.log(`  📁 Uploads: ${config.upload.dir}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

module.exports = app;
