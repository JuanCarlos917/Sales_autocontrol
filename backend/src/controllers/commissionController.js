// ═══════════════════════════════════════════════════════════════
// Controller — Commissions (comisiones por vehículo vendido)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const commissionService = require('../services/commissionService');

const list = async (req, res, next) => {
  try {
    const { status } = req.query;
    const items = await commissionService.listByVehicle(prisma, { status });
    res.json(items);
  } catch (err) { next(err); }
};

module.exports = { list };
