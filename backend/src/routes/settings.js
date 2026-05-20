const { Router } = require('express');
const ctrl = require('../controllers/settingsController');
const { authorize } = require('../middleware/auth');

const router = Router();

router.use(authorize('ADMIN'));

router.get('/', ctrl.getAll);
router.put('/', ctrl.update);

module.exports = router;
