const express = require('express');
const ctrl = require('../controllers/debtController');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/reconcile-candidates', ctrl.reconcileCandidates);
router.get('/:id', ctrl.findById);
router.post('/', validate(schemas.debtCreate), ctrl.create);
router.post('/:id/payments', validate(schemas.debtPayment), ctrl.addPayment);
router.post('/:id/reconcile', validate(schemas.debtReconcile), ctrl.reconcile);
router.post('/:id/cancel', ctrl.cancel);

module.exports = router;
