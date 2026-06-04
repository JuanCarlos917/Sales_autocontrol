const { Router } = require('express');
const ctrl = require('../controllers/settingsController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authorize('ADMIN'));

router.get('/', ctrl.getAll);
router.put('/', ctrl.update);
router.get('/commission-config', ctrl.getCommissionConfig);
router.put('/commission-config', validate(schemas.commissionConfig), ctrl.updateCommissionConfig);

module.exports = router;
