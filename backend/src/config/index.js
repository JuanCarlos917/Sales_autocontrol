// ═══════════════════════════════════════════════════════════════
// Config — Centraliza todas las variables de entorno y constantes
// ═══════════════════════════════════════════════════════════════

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // Uploads
  upload: {
    dir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'),
    maxSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024, // 10MB
  },

  // Rate Limiting (1000 for dev, lower in production)
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
  },

  // Admin seed
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@autocontrol.co',
    password: process.env.ADMIN_PASSWORD || 'admin1234',
    pin: process.env.ADMIN_PIN || '1234',
  },
};

module.exports = config;
