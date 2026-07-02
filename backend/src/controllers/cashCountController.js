// ═══════════════════════════════════════════════════════════════
// Controller — CashCount (Arqueos de caja)
// ═══════════════════════════════════════════════════════════════

const cashCountService = require('../services/cashCountService');

const getAll = async (req, res, next) => {
  try {
    const { accountId, startDate, endDate, limit, offset } = req.query;
    const result = await cashCountService.findAll({
      accountId,
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
    const cashCount = await cashCountService.findById(req.params.id);
    res.json(cashCount);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const cashCount = await cashCountService.create(req.body, req.user.id);
    res.status(201).json(cashCount);
  } catch (err) { next(err); }
};

const getLastByAccount = async (req, res, next) => {
  try {
    const cashCount = await cashCountService.getLastByAccount(req.params.accountId);
    res.json(cashCount);
  } catch (err) { next(err); }
};

const reverse = async (req, res, next) => {
  try {
    res.json(await cashCountService.reverse(req.params.id, req.body.reason, req.user.id));
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, getLastByAccount, reverse };
