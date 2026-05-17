// ═══════════════════════════════════════════════════════════════
// Routes — Alerts
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/alerts
 * Obtener todas las alertas activas
 */
router.get('/', alertController.getAllAlerts);

/**
 * GET /api/alerts/summary
 * Obtener resumen de alertas (conteos)
 */
router.get('/summary', alertController.getAlertsSummary);

module.exports = router;
