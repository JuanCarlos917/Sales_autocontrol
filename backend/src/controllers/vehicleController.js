// ═══════════════════════════════════════════════════════════════
// Controller — Vehicle
// ═══════════════════════════════════════════════════════════════

const vehicleService = require('../services/vehicleService');
const purchaseService = require('../services/purchaseService');
const saleService = require('../services/saleService');

const getAll = async (req, res, next) => {
  try {
    const { stage, search } = req.query;
    const vehicles = await vehicleService.findAll(req.user.id, { stage, search });
    res.json(vehicles);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.findById(req.params.id, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.create(req.body, req.user.id);
    res.status(201).json(vehicle);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.update(req.params.id, req.body, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const updateStage = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.updateStage(req.params.id, req.body.stage, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await vehicleService.delete(req.params.id, req.user.id);
    res.json({ message: 'Vehículo eliminado' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// FLUJO DE COMPRA CON TESORERÍA
// ═══════════════════════════════════════════════════════════════

/**
 * POST /vehicles/purchase
 * Crear vehículo con flujo de compra integrado
 */
const createWithPurchase = async (req, res, next) => {
  try {
    const { vehicle: vehicleData, payment: paymentData } = req.body;
    const result = await purchaseService.createVehicleWithPurchase(
      vehicleData,
      paymentData,
      req.user.id
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
};

/**
 * POST /vehicles/:id/payments
 * Registrar pago adicional a compra de vehículo
 */
const addPayment = async (req, res, next) => {
  try {
    const result = await purchaseService.addPurchasePayment(
      req.params.id,
      req.body,
      req.user.id
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
};

/**
 * GET /vehicles/:id/payment-status
 * Obtener estado de pagos de un vehículo
 */
const getPaymentStatus = async (req, res, next) => {
  try {
    const status = await purchaseService.getVehiclePaymentStatus(req.params.id);
    res.json(status);
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// FLUJO DE VENTA CON TESORERÍA
// ═══════════════════════════════════════════════════════════════

/**
 * POST /vehicles/:id/sell
 * Registrar venta de vehículo
 */
const registerSale = async (req, res, next) => {
  try {
    const result = await saleService.registerSale(
      req.params.id,
      req.body,
      req.user.id
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
};

/**
 * POST /vehicles/:id/collections
 * Registrar cobro de venta
 */
const addCollection = async (req, res, next) => {
  try {
    const result = await saleService.addSaleCollection(
      req.params.id,
      req.body,
      req.user.id
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
};

/**
 * GET /vehicles/:id/sale-summary
 * Obtener resumen de venta
 */
const getSaleSummary = async (req, res, next) => {
  try {
    const summary = await saleService.getSaleSummary(req.params.id);
    res.json(summary);
  } catch (err) { next(err); }
};

/**
 * POST /vehicles/:id/cancel-sale
 * Cancelar venta
 */
const cancelSale = async (req, res, next) => {
  try {
    const vehicle = await saleService.cancelSale(req.params.id, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getOne,
  create,
  update,
  updateStage,
  remove,
  createWithPurchase,
  addPayment,
  getPaymentStatus,
  registerSale,
  addCollection,
  getSaleSummary,
  cancelSale
};
