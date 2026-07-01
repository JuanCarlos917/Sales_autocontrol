const { Router } = require('express');
const ctrl = require('../controllers/debtController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.post('/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), ctrl.reverseDebtPayment);

module.exports = router;
