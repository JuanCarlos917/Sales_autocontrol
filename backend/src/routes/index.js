// ═══════════════════════════════════════════════════════════════
// Routes Index — Registra todas las rutas bajo /api
// ═══════════════════════════════════════════════════════════════

const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth'));
router.use('/vehicles', require('./vehicles'));
router.use('/expenses', require('./expenses'));
router.use('/documents', require('./documents'));
router.use('/dashboard', require('./dashboard'));
router.use('/settings', require('./settings'));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
