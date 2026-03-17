const { Router } = require('express');
const ctrl = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.use(authenticate);

router.get('/overview', ctrl.getOverview);
router.post('/projection', ctrl.getProjection);

module.exports = router;
