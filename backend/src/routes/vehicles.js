const { Router } = require('express');
const ctrl = require('../controllers/vehicleController');
const { validate, schemas } = require('../middleware/validation');

const router = Router();


// CRUD básico
router.get('/', ctrl.getAll);
router.get('/:id/audit', ctrl.getAuditLog);
router.get('/:id', ctrl.getOne);
router.post('/', validate(schemas.vehicle), ctrl.create);
router.put('/:id', validate(schemas.vehicleUpdate), ctrl.update);
router.patch('/:id/stage', validate(schemas.vehicleStage), ctrl.updateStage);
router.delete('/:id', ctrl.remove);

// Flujo de compra con tesorería
router.post('/purchase', validate(schemas.vehiclePurchase), ctrl.createWithPurchase);
router.post('/:id/confirm-purchase', validate(schemas.vehicleConfirmPurchase), ctrl.confirmPurchase);
router.get('/:id/payment-status', ctrl.getPaymentStatus);
router.post('/:id/payments', validate(schemas.vehiclePayment), ctrl.addPayment);

// Flujo de venta con tesorería
router.post('/:id/sell', validate(schemas.vehicleSale), ctrl.registerSale);
router.get('/:id/sale-summary', ctrl.getSaleSummary);
router.post('/:id/collections', validate(schemas.vehicleCollection), ctrl.addCollection);
router.post('/:id/cancel-sale', ctrl.cancelSale);

module.exports = router;
