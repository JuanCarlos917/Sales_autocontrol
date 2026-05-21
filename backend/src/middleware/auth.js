// ═══════════════════════════════════════════════════════════════
// Middleware — Auth (JWT verification + role guard)
// ═══════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../config/database');

/**
 * Verifica el JWT del header Authorization
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Usuario no autorizado' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

/**
 * Rol VIEWER = solo lectura. Bloquea cualquier método que muta estado.
 * Debe ir DESPUÉS de authenticate (necesita req.user). No aplica a /auth.
 */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const blockViewerWrites = (req, res, next) => {
  if (req.user && req.user.role === 'VIEWER' && !READ_ONLY_METHODS.has(req.method)) {
    return res.status(403).json({ error: 'Tu rol es de solo consulta: no puedes realizar cambios' });
  }
  next();
};

/**
 * Verifica que el usuario tenga uno de los roles permitidos
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
};

module.exports = { authenticate, authorize, blockViewerWrites };
