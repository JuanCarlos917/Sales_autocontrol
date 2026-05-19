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
router.put('/:id', validate(schemas.expenseUpdate), ctrl.update);
router.delete('/:id', validate(schemas.expenseDelete), ctrl.remove);
router.post('/:id/restore', ctrl.restore);

// Pagos / estado
router.get('/:id/payment-status', ctrl.getPaymentStatus);
router.post('/:id/pay', validate(schemas.expensePayment), ctrl.payExpense);

// Audit log
router.get('/:id/audit', ctrl.getAuditLog);

module.exports = router;
