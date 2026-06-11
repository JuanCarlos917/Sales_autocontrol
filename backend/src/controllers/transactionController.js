// ═══════════════════════════════════════════════════════════════
// Controller — Transaction (Movimientos de tesorería)
// ═══════════════════════════════════════════════════════════════

const transactionService = require('../services/transactionService');

const getAll = async (req, res, next) => {
  try {
    const { accountId, vehicleId, thirdPartyId, type, category, startDate, endDate, limit, offset } = req.query;
    const result = await transactionService.findAll({
      accountId,
      vehicleId,
      thirdPartyId,
      type,
      category,
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
    const transaction = await transactionService.findById(req.params.id);
    res.json(transaction);
  } catch (err) { next(err); }
};

const getByVehicle = async (req, res, next) => {
  try {
    const transactions = await transactionService.findByVehicle(req.params.vehicleId);
    res.json(transactions);
  } catch (err) { next(err); }
};

const createIncome = async (req, res, next) => {
  try {
    const transaction = await transactionService.createIncome(req.body, req.user.id);
    res.status(201).json(transaction);
  } catch (err) { next(err); }
};

const createExpense = async (req, res, next) => {
  try {
    const transaction = await transactionService.createExpense(req.body, req.user.id);
    res.status(201).json(transaction);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const transaction = await transactionService.update(req.params.id, req.body, req.user.id);
    res.json(transaction);
  } catch (err) { next(err); }
};

const getSummary = async (req, res, next) => {
  try {
    const { startDate, endDate, accountId } = req.query;
    const summary = await transactionService.getSummary({ startDate, endDate, accountId });
    res.json(summary);
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, getByVehicle, createIncome, createExpense, update, getSummary };
