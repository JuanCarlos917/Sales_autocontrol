// ═══════════════════════════════════════════════════════════════
// Routes — Auth
// ═══════════════════════════════════════════════════════════════

const { Router } = require('express');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.post('/register', validate(schemas.register), ctrl.register);
router.post('/login', validate(schemas.login), ctrl.login);
router.post('/pin-login', validate(schemas.pinLogin), ctrl.pinLogin);
router.post('/refresh', ctrl.refreshToken);
router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.me);
router.put('/change-password', authenticate, validate(schemas.changePassword), ctrl.changePassword);

module.exports = router;
