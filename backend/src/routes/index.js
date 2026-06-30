// ═══════════════════════════════════════════════════════════════
// Routes Index — Registra todas las rutas bajo /api
// ═══════════════════════════════════════════════════════════════

const { Router } = require('express');
const { authenticate, blockViewerWrites } = require('../middleware/auth');

const router = Router();

// ── Rutas públicas / de sesión ──
router.use('/auth', require('./auth'));
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── A partir de aquí: requiere sesión; el rol VIEWER es estrictamente solo lectura ──
router.use(authenticate);
router.use(blockViewerWrites);

router.use('/vehicles', require('./vehicles'));
router.use('/expenses', require('./expenses'));
router.use('/documents', require('./documents'));
router.use('/dashboard', require('./dashboard'));
router.use('/settings', require('./settings'));
router.use('/treasury', require('./treasury'));
router.use('/payables', require('./payables'));
router.use('/alerts', require('./alerts'));
router.use('/loans', require('./loans'));
router.use('/loan-payments', require('./loanPayments'));
router.use('/debts', require('./debts'));
router.use('/users', require('./users'));

module.exports = router;
