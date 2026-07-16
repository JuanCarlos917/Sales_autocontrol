// ═══════════════════════════════════════════════════════════════
// Controller — Investors (ganancia por vehículo vendido, por inversionista)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const investorService = require('../services/investorService');

const list = async (req, res, next) => {
  try {
    const { status } = req.query;
    const items = await investorService.listByVehicle(prisma, { status });
    res.json(items);
  } catch (err) { next(err); }
};

const summary = async (req, res, next) => {
  try {
    res.json(await investorService.getSummary(prisma));
  } catch (err) { next(err); }
};

module.exports = { list, summary };
