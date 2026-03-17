const { Router } = require('express');
const ctrl = require('../controllers/settingsController');
const { authenticate, authorize } = require('../middleware/auth');

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/', ctrl.getAll);
router.put('/', ctrl.update);

module.exports = router;
