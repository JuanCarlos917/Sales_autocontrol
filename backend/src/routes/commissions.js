const { Router } = require('express');
const ctrl = require('../controllers/commissionController');

const router = Router();

router.get('/summary', ctrl.summary);
router.get('/', ctrl.list);

module.exports = router;
