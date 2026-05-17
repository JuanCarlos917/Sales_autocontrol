// ═══════════════════════════════════════════════════════════════
// Payables Routes — CxC / CxP Endpoints
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const payableService = require('../services/payableService');
const { validate, schemas } = require('../middleware/validation');
const { authenticate } = require('../middleware/auth');

// Todas las rutas requieren autenticacion
router.use(authenticate);

/**
 * GET /api/payables/summary
 * Obtener resumen de CxC/CxP
 */
router.get('/summary', async (req, res) => {
  try {
    const summary = await payableService.getSummary();
    res.json(summary);
  } catch (error) {
    console.error('Error getting payables summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payables/upcoming
 * Obtener CxC/CxP proximas a vencer
 */
router.get('/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const upcoming = await payableService.getUpcoming(days);
    res.json(upcoming);
  } catch (error) {
    console.error('Error getting upcoming payables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payables
 * Listar todas las CxC/CxP con filtros
 */
router.get('/', async (req, res) => {
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
  } catch (error) {
    console.error('Error listing payables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payables/:id
 * Obtener detalle de una CxC/CxP
 */
router.get('/:id', async (req, res) => {
  try {
    const payable = await payableService.getById(req.params.id);
    res.json(payable);
  } catch (error) {
    console.error('Error getting payable:', error);
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * POST /api/payables
 * Crear una nueva CxC/CxP
 */
router.post('/', validate(schemas.payable), async (req, res) => {
  try {
    const payable = await payableService.create(req.body, req.user.id);
    res.status(201).json(payable);
  } catch (error) {
    console.error('Error creating payable:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/payables/:id/payments
 * Registrar un pago a una CxC/CxP
 */
router.post('/:id/payments', validate(schemas.payablePayment), async (req, res) => {
  try {
    const result = await payableService.addPayment(req.params.id, req.body, req.user.id);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding payment:', error);
    const status = error.message.includes('no encontrada') ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

/**
 * POST /api/payables/:id/cancel
 * Cancelar una CxC/CxP
 */
router.post('/:id/cancel', async (req, res) => {
  try {
    const payable = await payableService.cancel(req.params.id, req.user.id);
    res.json(payable);
  } catch (error) {
    console.error('Error cancelling payable:', error);
    const status = error.message.includes('no encontrada') ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
