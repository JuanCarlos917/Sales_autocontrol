// ═══════════════════════════════════════════════════════════════
// Payables Routes — CxC / CxP Endpoints
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const payableService = require('../services/payableService');
const { validate, schemas } = require('../middleware/validation');

// Todas las rutas requieren autenticacion

/**
 * GET /api/payables/summary
 * Obtener resumen de CxC/CxP
 */
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await payableService.getSummary();
    res.json(summary);
  } catch (error) { next(error); }
});

/**
 * GET /api/payables/upcoming
 * Obtener CxC/CxP proximas a vencer
 */
router.get('/upcoming', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const upcoming = await payableService.getUpcoming(days);
    res.json(upcoming);
  } catch (error) { next(error); }
});

/**
 * GET /api/payables
 * Listar todas las CxC/CxP con filtros
 */
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      type: req.query.type,
      status: req.query.status,
      vehicleId: req.query.vehicleId,
      thirdPartyId: req.query.thirdPartyId,
      overdue: req.query.overdue
    };
    const payables = await payableService.getAll(filters);
    res.json(payables);
  } catch (error) { next(error); }
});

/**
 * GET /api/payables/:id
 * Obtener detalle de una CxC/CxP
 */
router.get('/:id', async (req, res, next) => {
  try {
    const payable = await payableService.getById(req.params.id);
    res.json(payable);
  } catch (error) { next(error); }
});

/**
 * POST /api/payables
 * Crear una nueva CxC/CxP
 */
router.post('/', validate(schemas.payable), async (req, res, next) => {
  try {
    const payable = await payableService.create(req.body, req.user.id);
    res.status(201).json(payable);
  } catch (error) { next(error); }
});

/**
 * POST /api/payables/:id/payments
 * Registrar un pago a una CxC/CxP
 */
router.post('/:id/payments', validate(schemas.payablePayment), async (req, res, next) => {
  try {
    const result = await payableService.addPayment(req.params.id, req.body, req.user.id);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

/**
 * POST /api/payables/:id/cancel
 * Cancelar una CxC/CxP
 */
router.post('/:id/cancel', validate(schemas.treasuryDestructive), async (req, res, next) => {
  try {
    const payable = await payableService.cancel(req.params.id, req.user.id, { reason: req.body.reason });
    res.json(payable);
  } catch (error) { next(error); }
});

module.exports = router;
