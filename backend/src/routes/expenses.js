const { Router } = require('express');
const ctrl = require('../controllers/expenseController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authenticate);

router.get('/', ctrl.getAll);
router.get('/vehicle/:vehicleId', ctrl.getByVehicle);
router.post('/', validate(schemas.expense), ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
