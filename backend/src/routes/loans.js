const express = require('express');
const ctrl = require('../controllers/loanController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.findById);
router.post('/', validate(schemas.loanCreate), ctrl.create);
router.post('/:id/payments', validate(schemas.loanPayment), ctrl.addPayment);
router.post('/:id/cancel', ctrl.cancel);

module.exports = router;
