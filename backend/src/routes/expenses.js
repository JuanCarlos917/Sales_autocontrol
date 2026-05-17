const { Router } = require('express');
const ctrl = require('../controllers/expenseController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authenticate);

// Lectura
router.get('/', ctrl.getAll);
router.get('/vehicle/:vehicleId', ctrl.getByVehicle);
router.get('/unpaid', ctrl.getUnpaid);

// Creación (siempre integrada con tesorería)
router.post('/', validate(schemas.expenseWithTreasury), ctrl.createWithTreasury);
router.post('/with-treasury', validate(schemas.expenseWithTreasury), ctrl.createWithTreasury);

// Mantenimiento
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

// Pagos / estado
router.get('/:id/payment-status', ctrl.getPaymentStatus);
router.post('/:id/pay', validate(schemas.expensePayment), ctrl.payExpense);

module.exports = router;
