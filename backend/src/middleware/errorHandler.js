// ═══════════════════════════════════════════════════════════════
// Middleware — Error Handler global
// ═══════════════════════════════════════════════════════════════

const config = require('../config');

class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
};

const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';

  if (config.nodeEnv === 'development') {
    console.error('Error:', err);
  }

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Registro duplicado', field: err.meta?.target });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro no encontrado' });
  }

  res.status(statusCode).json({
    error: message,
    ...(config.nodeEnv === 'development' && { stack: err.stack }),
  });
};

module.exports = { AppError, notFoundHandler, errorHandler };
