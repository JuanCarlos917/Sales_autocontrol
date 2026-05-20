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
  // Errores conocidos de Prisma → respuestas 4xx (no son fallos del servidor)
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Registro duplicado', field: err.meta?.target });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro no encontrado' });
  }

  const statusCode = err.statusCode || 500;
  const isServerError = !err.isOperational || statusCode >= 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';

  // Los errores del servidor (5xx / no operacionales) SIEMPRE se loguean —también en
  // producción— para no quedar ciegos. Los detalles nunca se envían al cliente en prod.
  if (isServerError) {
    const method = req?.method || '?';
    const url = req?.originalUrl || req?.url || '?';
    console.error(`[${new Date().toISOString()}] ${method} ${url} →`, err);
  }

  res.status(statusCode).json({
    error: message,
    ...(config.nodeEnv === 'development' && { stack: err.stack }),
  });
};

module.exports = { AppError, notFoundHandler, errorHandler };
