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

/**
 * POST /expenses  (y /expenses/with-treasury)
 * Crear gasto con integración obligatoria de tesorería
 */
const createWithTreasury = async (req, res, next) => {
  try {
    const result = await expenseService.createWithTreasury(req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const expense = await expenseService.update(req.params.id, req.body, req.user.id);
    res.json(expense);
  } catch (err) { next(err); }
};

/**
 * POST /expenses/:id/pay
 * Registrar pago de gasto (total o parcial)
 */
const payExpense = async (req, res, next) => {
  try {
    const result = await expenseService.payExpense(req.params.id, req.body, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
};

/**
 * GET /expenses/:id/payment-status
 * Obtener estado de pago de un gasto
 */
const getPaymentStatus = async (req, res, next) => {
  try {
    const status = await expenseService.getPaymentStatus(req.params.id, req.user.id);
    res.json(status);
  } catch (err) { next(err); }
};

/**
 * GET /expenses/unpaid
 * Obtener gastos pendientes de pago
 */
const getUnpaid = async (req, res, next) => {
  try {
    const { vehicleId } = req.query;
    const expenses = await expenseService.getUnpaidExpenses(req.user.id, vehicleId || null);
    res.json(expenses);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await expenseService.delete(req.params.id, req.user.id);
    res.json({ message: 'Gasto eliminado' });
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getByVehicle,
  createWithTreasury,
  update,
  payExpense,
  getPaymentStatus,
  getUnpaid,
  remove
};
