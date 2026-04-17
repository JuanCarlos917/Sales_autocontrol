const { Router } = require('express');
const ctrl = require('../controllers/expenseController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authenticate);

// CRUD básico
router.get('/', ctrl.getAll);
router.get('/vehicle/:vehicleId', ctrl.getByVehicle);
router.get('/unpaid', ctrl.getUnpaid);
router.post('/', validate(schemas.expense), ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

// Integración con tesorería
router.post('/with-payment', validate(schemas.expense), ctrl.createWithPayment);
router.post('/with-treasury', validate(schemas.expenseWithTreasury), ctrl.createWithTreasury);
router.get('/:id/payment-status', ctrl.getPaymentStatus);
router.post('/:id/pay', validate(schemas.expensePayment), ctrl.payExpense);

module.exports = router;
