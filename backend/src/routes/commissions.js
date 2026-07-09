const { Router } = require('express');
const ctrl = require('../controllers/commissionController');

const router = Router();

router.get('/', ctrl.list);

module.exports = router;
