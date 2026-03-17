// ═══════════════════════════════════════════════════════════════
// Controller — Expense
// ═══════════════════════════════════════════════════════════════

const expenseService = require('../services/expenseService');

const getAll = async (req, res, next) => {
  try {
    const { category, paid } = req.query;
    const expenses = await expenseService.findAll(req.user.id, {
      category,
      paid: paid !== undefined ? paid === 'true' : undefined,
    });
    res.json(expenses);
  } catch (err) { next(err); }
};

const getByVehicle = async (req, res, next) => {
  try {
    const expenses = await expenseService.findByVehicle(req.params.vehicleId, req.user.id);
    res.json(expenses);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const expense = await expenseService.create(req.body, req.user.id);
    res.status(201).json(expense);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const expense = await expenseService.update(req.params.id, req.body, req.user.id);
    res.json(expense);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await expenseService.delete(req.params.id, req.user.id);
    res.json({ message: 'Gasto eliminado' });
  } catch (err) { next(err); }
};

module.exports = { getAll, getByVehicle, create, update, remove };
