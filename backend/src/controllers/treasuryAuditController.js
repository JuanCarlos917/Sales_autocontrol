// ═══════════════════════════════════════════════════════════════
// Controller — Treasury Audit Log
// Lectura polimórfica del audit log de tesorería.
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { VALID_ENTITIES } = require('../utils/treasuryAudit');

const list = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) {
      throw new AppError('entityType y entityId son requeridos', 400);
    }
    if (!VALID_ENTITIES.includes(entityType)) {
      throw new AppError(`entityType inválido. Debe ser uno de: ${VALID_ENTITIES.join(', ')}`, 400);
    }

    const entries = await prisma.treasuryAuditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.json(entries);
  } catch (err) { next(err); }
};

module.exports = { list };
