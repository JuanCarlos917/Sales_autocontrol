const { Router } = require('express');
const ctrl = require('../controllers/investorController');

const router = Router();

router.get('/summary', ctrl.summary);
router.get('/', ctrl.list);

module.exports = router;
