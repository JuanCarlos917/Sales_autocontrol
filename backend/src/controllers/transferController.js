// ═══════════════════════════════════════════════════════════════
// Controller — Transfer (Transferencias entre cuentas)
// ═══════════════════════════════════════════════════════════════

const transferService = require('../services/transferService');

const getAll = async (req, res, next) => {
  try {
    const { startDate, endDate, limit, offset } = req.query;
    const result = await transferService.findAll({
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const transfer = await transferService.findById(req.params.id);
    res.json(transfer);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const transfer = await transferService.create(req.body, req.user.id);
    res.status(201).json(transfer);
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create };
